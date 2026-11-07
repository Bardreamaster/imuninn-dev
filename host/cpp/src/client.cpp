#include "imuninn/client.hpp"

#include <arpa/inet.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>
#include <unistd.h>

#include <chrono>
#include <cstring>
#include <random>
#include <stdexcept>

namespace imuninn {

namespace {

int64_t wall_ns() {
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
             std::chrono::system_clock::now().time_since_epoch())
      .count();
}

int tcp_connect(const std::string& host, int port) {
  addrinfo hints{};
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  addrinfo* res = nullptr;
  if (getaddrinfo(host.c_str(), std::to_string(port).c_str(), &hints, &res) != 0 || !res)
    throw std::runtime_error("cannot resolve " + host);
  int fd = -1;
  for (addrinfo* p = res; p; p = p->ai_next) {
    fd = ::socket(p->ai_family, p->ai_socktype, p->ai_protocol);
    if (fd < 0) continue;
    if (::connect(fd, p->ai_addr, p->ai_addrlen) == 0) break;
    ::close(fd);
    fd = -1;
  }
  freeaddrinfo(res);
  if (fd < 0) throw std::runtime_error("cannot connect to " + host + ":" + std::to_string(port));
  int one = 1;
  setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
  return fd;
}

bool read_exact(int fd, void* buf, size_t n) {
  auto* p = static_cast<uint8_t*>(buf);
  while (n > 0) {
    ssize_t r = ::recv(fd, p, n, 0);
    if (r <= 0) return false;
    p += r;
    n -= size_t(r);
  }
  return true;
}

bool write_all(int fd, const void* buf, size_t n) {
  auto* p = static_cast<const uint8_t*>(buf);
  while (n > 0) {
    ssize_t w = ::send(fd, p, n, 0);
    if (w <= 0) return false;
    p += w;
    n -= size_t(w);
  }
  return true;
}

std::string base64(const uint8_t* data, size_t n) {
  static const char* tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  for (size_t i = 0; i < n; i += 3) {
    uint32_t v = data[i] << 16 | (i + 1 < n ? data[i + 1] << 8 : 0) | (i + 2 < n ? data[i + 2] : 0);
    out += tbl[(v >> 18) & 63];
    out += tbl[(v >> 12) & 63];
    out += i + 1 < n ? tbl[(v >> 6) & 63] : '=';
    out += i + 2 < n ? tbl[v & 63] : '=';
  }
  return out;
}

// Minimal RFC 6455 client: binary frames, masked, handles ping/close.
void ws_handshake(int fd, const std::string& host, int port) {
  std::random_device rd;
  uint8_t key[16];
  for (auto& k : key) k = uint8_t(rd());
  std::string req = "GET / HTTP/1.1\r\nHost: " + host + ":" + std::to_string(port) +
                    "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + base64(key, 16) +
                    "\r\nSec-WebSocket-Version: 13\r\n\r\n";
  if (!write_all(fd, req.data(), req.size())) throw std::runtime_error("websocket handshake send failed");
  std::string resp;
  char c;
  while (resp.find("\r\n\r\n") == std::string::npos) {
    if (::recv(fd, &c, 1, 0) != 1) throw std::runtime_error("websocket handshake read failed");
    resp += c;
    if (resp.size() > 8192) throw std::runtime_error("websocket handshake too long");
  }
  if (resp.find(" 101 ") == std::string::npos) throw std::runtime_error("websocket upgrade refused: " + resp.substr(0, 60));
}

bool ws_send(int fd, uint8_t opcode, const std::string& payload) {
  std::vector<uint8_t> frame;
  frame.push_back(0x80 | opcode);
  size_t n = payload.size();
  if (n < 126) {
    frame.push_back(uint8_t(0x80 | n));
  } else if (n < 65536) {
    frame.push_back(0x80 | 126);
    frame.push_back(uint8_t(n >> 8));
    frame.push_back(uint8_t(n));
  } else {
    frame.push_back(0x80 | 127);
    for (int i = 7; i >= 0; --i) frame.push_back(uint8_t(uint64_t(n) >> (8 * i)));
  }
  static thread_local std::mt19937 rng{std::random_device{}()};
  uint8_t mask[4];
  uint32_t m = rng();
  std::memcpy(mask, &m, 4);
  frame.insert(frame.end(), mask, mask + 4);
  size_t off = frame.size();
  frame.resize(off + n);
  for (size_t i = 0; i < n; ++i) frame[off + i] = uint8_t(payload[i]) ^ mask[i & 3];
  return write_all(fd, frame.data(), frame.size());
}

// Returns opcode, fills payload; false on EOF/error.
bool ws_recv(int fd, uint8_t& opcode, std::string& payload) {
  payload.clear();
  for (;;) {  // loop over fragments
    uint8_t h[2];
    if (!read_exact(fd, h, 2)) return false;
    bool fin = h[0] & 0x80;
    uint8_t op = h[0] & 0x0f;
    bool masked = h[1] & 0x80;
    uint64_t n = h[1] & 0x7f;
    if (n == 126) {
      uint8_t b[2];
      if (!read_exact(fd, b, 2)) return false;
      n = uint64_t(b[0]) << 8 | b[1];
    } else if (n == 127) {
      uint8_t b[8];
      if (!read_exact(fd, b, 8)) return false;
      n = 0;
      for (int i = 0; i < 8; ++i) n = n << 8 | b[i];
    }
    uint8_t mask[4] = {0, 0, 0, 0};
    if (masked && !read_exact(fd, mask, 4)) return false;
    std::string chunk(n, '\0');
    if (n && !read_exact(fd, chunk.data(), n)) return false;
    if (masked)
      for (uint64_t i = 0; i < n; ++i) chunk[i] = char(uint8_t(chunk[i]) ^ mask[i & 3]);
    if (op == 0x9) {  // ping -> pong
      ws_send(fd, 0xA, chunk);
      continue;
    }
    if (op == 0xA) continue;  // pong
    if (op == 0x8) {
      opcode = 0x8;
      return true;
    }
    if (op != 0) opcode = op;
    payload += chunk;
    if (fin) return true;
  }
}

}  // namespace

Client::Client(std::string host, int control_port, std::string client_name)
    : host_(std::move(host)), control_port_(control_port), client_name_(std::move(client_name)) {}

Client::~Client() { close(); }

void Client::connect() {
  // UDP receive socket on an ephemeral port; its port goes into Hello.
  udp_fd_ = ::socket(AF_INET, SOCK_DGRAM, 0);
  sockaddr_in a{};
  a.sin_family = AF_INET;
  a.sin_addr.s_addr = htonl(INADDR_ANY);
  a.sin_port = 0;
  if (::bind(udp_fd_, reinterpret_cast<sockaddr*>(&a), sizeof(a)) != 0) throw std::runtime_error("udp bind failed");
  socklen_t alen = sizeof(a);
  getsockname(udp_fd_, reinterpret_cast<sockaddr*>(&a), &alen);
  int udp_port = ntohs(a.sin_port);
  int rcvbuf = 4 * 1024 * 1024;
  setsockopt(udp_fd_, SOL_SOCKET, SO_RCVBUF, &rcvbuf, sizeof(rcvbuf));

  ws_fd_ = tcp_connect(host_, control_port_);
  ws_handshake(ws_fd_, host_, control_port_);
  closing_ = false;
  control_thread_ = std::thread([this] { control_loop(); });

  pb::ControlMessage hello;
  hello.mutable_hello()->mutable_client()->set_name(client_name_);
  hello.mutable_hello()->mutable_client()->set_version("cpp-0.1");
  hello.mutable_hello()->set_udp_port(uint32_t(udp_port));
  hello.mutable_hello()->set_protocol_version(4);
  pb::ControlMessage welcome = request(std::move(hello));
  if (!welcome.has_welcome()) throw std::runtime_error("expected Welcome");
  device_ = welcome.welcome().device();
  capabilities_ = welcome.welcome().capabilities();
  {
    std::lock_guard<std::mutex> lk(config_mutex_);
    config_ = capabilities_.config();
  }
  client_id_ = welcome.welcome().client_id();
  tcp_port_ = int(welcome.welcome().tcp_port());

  if (tcp_port_ > 0) {
    tcp_fd_ = tcp_connect(host_, tcp_port_);
    uint32_t id_le = client_id_;  // little-endian on all supported hosts
    write_all(tcp_fd_, &id_le, 4);
    tcp_thread_ = std::thread([this] { tcp_loop(); });
  }
  udp_thread_ = std::thread([this] { udp_loop(); });

  time_sync();
  std::vector<std::string> all;
  for (const auto& s : capabilities_.streams()) all.push_back(s.stream_id());
  subscribe(all);
  connected_ = true;
}

void Client::close() {
  if (closing_.exchange(true)) return;
  connected_ = false;
  if (ws_fd_ >= 0) ::shutdown(ws_fd_, SHUT_RDWR), ::close(ws_fd_), ws_fd_ = -1;
  if (tcp_fd_ >= 0) ::shutdown(tcp_fd_, SHUT_RDWR), ::close(tcp_fd_), tcp_fd_ = -1;
  if (udp_fd_ >= 0) ::shutdown(udp_fd_, SHUT_RDWR), ::close(udp_fd_), udp_fd_ = -1;
  pending_cv_.notify_all();
  if (control_thread_.joinable()) control_thread_.join();
  if (tcp_thread_.joinable()) tcp_thread_.join();
  if (udp_thread_.joinable()) udp_thread_.join();
}

pb::DeviceConfig Client::config() const {
  std::lock_guard<std::mutex> lk(config_mutex_);
  return config_;
}

void Client::send(const pb::ControlMessage& msg) {
  std::lock_guard<std::mutex> lk(send_mutex_);
  if (!ws_send(ws_fd_, 0x2, msg.SerializeAsString())) throw std::runtime_error("control send failed");
}

pb::ControlMessage Client::request(pb::ControlMessage msg, int timeout_ms) {
  uint64_t id;
  {
    std::lock_guard<std::mutex> lk(pending_mutex_);
    id = next_request_id_++;
  }
  msg.set_request_id(id);
  send(msg);
  std::unique_lock<std::mutex> lk(pending_mutex_);
  if (!pending_cv_.wait_for(lk, std::chrono::milliseconds(timeout_ms),
                            [&] { return replies_.count(id) > 0 || closing_; }))
    throw std::runtime_error("request timed out");
  auto it = replies_.find(id);
  if (it == replies_.end()) throw std::runtime_error("connection closed");
  pb::ControlMessage reply = std::move(it->second);
  replies_.erase(it);
  if (reply.has_error()) throw std::runtime_error("phone error " + std::to_string(reply.error().code()) + ": " + reply.error().message());
  return reply;
}

void Client::control_loop() {
  uint8_t op;
  std::string payload;
  while (!closing_ && ws_recv(ws_fd_, op, payload)) {
    if (op == 0x8) break;
    pb::ControlMessage msg;
    if (!msg.ParseFromString(payload)) continue;
    if (msg.request_id() != 0) {
      std::lock_guard<std::mutex> lk(pending_mutex_);
      replies_[msg.request_id()] = std::move(msg);
      pending_cv_.notify_all();
      continue;
    }
    if (msg.has_config_changed()) {
      {
        std::lock_guard<std::mutex> lk(config_mutex_);
        config_ = msg.config_changed().config();
      }
      if (on_config_) on_config_(msg.config_changed().config());
    }
  }
  connected_ = false;
  pending_cv_.notify_all();
}

void Client::udp_loop() {
  std::vector<uint8_t> buf(65536);
  while (!closing_) {
    ssize_t n = ::recv(udp_fd_, buf.data(), buf.size(), 0);
    if (n <= 0) break;
    pb::DataMessage msg;
    if (msg.ParseFromArray(buf.data(), int(n))) dispatch(msg);
  }
}

void Client::tcp_loop() {
  std::string payload;
  while (!closing_) {
    uint32_t len_le;
    if (!read_exact(tcp_fd_, &len_le, 4)) break;
    uint32_t n = len_le;  // little-endian
    if (n > 64u * 1024 * 1024) break;
    payload.resize(n);
    if (!read_exact(tcp_fd_, payload.data(), n)) break;
    pb::DataMessage msg;
    if (msg.ParseFromString(payload)) dispatch(msg);
  }
}

void Client::dispatch(const pb::DataMessage& msg) {
  const pb::Header* h = nullptr;
  switch (msg.body_case()) {
    case pb::DataMessage::kImu: h = &msg.imu().header(); break;
    case pb::DataMessage::kPose: h = &msg.pose().header(); break;
    case pb::DataMessage::kVideo: h = &msg.video().header(); break;
    case pb::DataMessage::kDepth: h = &msg.depth().header(); break;
    default: break;
  }
  if (h) {
    std::lock_guard<std::mutex> lk(stats_mutex_);
    auto& st = stats_[h->stream_id()];
    st.count++;
    if (st.last_seq >= 0 && int64_t(h->seq()) > st.last_seq + 1) st.dropped += uint64_t(int64_t(h->seq()) - st.last_seq - 1);
    st.last_seq = int64_t(h->seq());
  }
  switch (msg.body_case()) {
    case pb::DataMessage::kImu: if (on_imu_) on_imu_(msg.imu()); break;
    case pb::DataMessage::kPose: if (on_pose_) on_pose_(msg.pose()); break;
    case pb::DataMessage::kVideo: if (on_video_) on_video_(msg.video()); break;
    case pb::DataMessage::kDepth: if (on_depth_) on_depth_(msg.depth()); break;
    default: break;
  }
}

void Client::start() { pb::ControlMessage m; m.mutable_session_control()->set_action(pb::SessionControl::ACTION_START); send(m); }
void Client::stop() { pb::ControlMessage m; m.mutable_session_control()->set_action(pb::SessionControl::ACTION_STOP); send(m); }
void Client::start_recording() { pb::ControlMessage m; m.mutable_session_control()->set_action(pb::SessionControl::ACTION_START_RECORDING); send(m); }
void Client::stop_recording() { pb::ControlMessage m; m.mutable_session_control()->set_action(pb::SessionControl::ACTION_STOP_RECORDING); send(m); }

void Client::subscribe(const std::vector<std::string>& streams, bool unsubscribe) {
  pb::ControlMessage m;
  for (const auto& s : streams) m.mutable_subscribe()->add_stream_ids(s);
  m.mutable_subscribe()->set_unsubscribe(unsubscribe);
  send(m);
}

pb::ConfigResult Client::set_config(const pb::DeviceConfig& patch) {
  pb::ControlMessage m;
  {
    std::lock_guard<std::mutex> lk(config_mutex_);
    m.mutable_set_config()->set_base_config_version(config_.config_version());
  }
  *m.mutable_set_config()->mutable_patch() = patch;
  pb::ControlMessage reply = request(std::move(m));
  if (reply.config_result().config_version()) {
    std::lock_guard<std::mutex> lk(config_mutex_);
    config_.set_config_version(reply.config_result().config_version());
  }
  return reply.config_result();
}

pb::ConfigResult Client::set_value(const std::string& key, pb::Value value) {
  pb::DeviceConfig patch;
  auto dot = key.find('.');
  std::string head = key.substr(0, dot), rest = dot == std::string::npos ? "" : key.substr(dot + 1);
  if (head == "session" && rest == "mode") {
    patch.set_mode(value.s() == "camera" ? pb::SESSION_MODE_CAMERA : pb::SESSION_MODE_AR);
  } else if (head == "session") {
    (*patch.mutable_session_params())[rest] = std::move(value);
  } else {
    auto* sc = patch.add_streams();
    sc->set_stream_id(head);
    if (rest == "enabled") sc->set_enabled(value.b());
    else (*sc->mutable_params())[rest] = std::move(value);
  }
  return set_config(patch);
}

pb::ConfigResult Client::set(const std::string& key, bool v) { pb::Value x; x.set_b(v); return set_value(key, std::move(x)); }
pb::ConfigResult Client::set(const std::string& key, int64_t v) { pb::Value x; x.set_i(v); return set_value(key, std::move(x)); }
pb::ConfigResult Client::set(const std::string& key, double v) { pb::Value x; x.set_f(v); return set_value(key, std::move(x)); }
pb::ConfigResult Client::set(const std::string& key, const std::string& v) { pb::Value x; x.set_s(v); return set_value(key, std::move(x)); }

int64_t Client::time_sync(int rounds) {
  int64_t best_rtt = -1, best_offset = 0;
  for (int i = 0; i < rounds; ++i) {
    int64_t t1 = wall_ns();
    pb::ControlMessage m;
    m.mutable_time_sync_ping()->set_client_send_ns(uint64_t(t1));
    pb::ControlMessage reply;
    try { reply = request(std::move(m), 2000); } catch (const std::exception&) { continue; }
    int64_t t4 = wall_ns();
    int64_t t2 = int64_t(reply.time_sync_pong().device_recv_ns());
    int64_t t3 = int64_t(reply.time_sync_pong().device_send_ns());
    int64_t rtt = (t4 - t1) - (t3 - t2);
    int64_t offset_dev_minus_pc = ((t2 - t1) + (t3 - t4)) / 2;
    if (best_rtt < 0 || rtt < best_rtt) { best_rtt = rtt; best_offset = -offset_dev_minus_pc; }
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }
  if (best_rtt >= 0) clock_offset_ns_ = best_offset;
  return clock_offset_ns_;
}

std::map<std::string, StreamStats> Client::stats() const {
  std::lock_guard<std::mutex> lk(stats_mutex_);
  return stats_;
}

}  // namespace imuninn
