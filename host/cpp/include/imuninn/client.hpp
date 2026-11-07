// iMuninn C++ client (§7.1): connect to a phone, receive pose / IMU / video / depth,
// change parameters. Header-only API over a small POSIX implementation; no
// dependencies beyond protobuf. Discovery (Bonjour) is not included: take the
// address from `imuninn list` or the phone screen.
#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "imuninn.pb.h"

namespace imuninn {

namespace pb = ::imuninn::v1;

struct StreamStats {
  uint64_t count = 0;
  uint64_t dropped = 0;
  int64_t last_seq = -1;
};

class Client {
 public:
  Client(std::string host, int control_port = 7420, std::string client_name = "imuninn-cpp");
  ~Client();

  // Blocking: control WebSocket + Hello/Welcome, TCP data stream, clock sync, subscribe all.
  void connect();
  void close();
  bool connected() const { return connected_; }

  const pb::DeviceInfo& device() const { return device_; }
  const pb::Capabilities& capabilities() const { return capabilities_; }
  pb::DeviceConfig config() const;

  // Callbacks run on the receiving threads; keep them short.
  void on_pose(std::function<void(const pb::PoseSample&)> cb) { on_pose_ = std::move(cb); }
  void on_imu(std::function<void(const pb::ImuSample&)> cb) { on_imu_ = std::move(cb); }
  void on_video(std::function<void(const pb::VideoFrame&)> cb) { on_video_ = std::move(cb); }
  void on_depth(std::function<void(const pb::DepthFrame&)> cb) { on_depth_ = std::move(cb); }
  void on_config(std::function<void(const pb::DeviceConfig&)> cb) { on_config_ = std::move(cb); }

  void start();
  void stop();
  void start_recording();
  void stop_recording();
  void subscribe(const std::vector<std::string>& streams, bool unsubscribe = false);

  // Partial update: "session.mode", "session.<param>" (e.g. session.black_screen), "<stream>.enabled", "<stream>.<param>".
  pb::ConfigResult set(const std::string& key, bool v);
  pb::ConfigResult set(const std::string& key, int64_t v);
  pb::ConfigResult set(const std::string& key, double v);
  pb::ConfigResult set(const std::string& key, const std::string& v);
  pb::ConfigResult set_config(const pb::DeviceConfig& patch);

  // NTP-style; returns pc_time_ns - device_time_ns (wall clock, nanoseconds).
  int64_t time_sync(int rounds = 8);
  int64_t clock_offset_ns() const { return clock_offset_ns_; }
  int64_t to_pc_time_ns(uint64_t device_time_ns) const { return int64_t(device_time_ns) + clock_offset_ns_; }

  std::map<std::string, StreamStats> stats() const;

 private:
  pb::ControlMessage request(pb::ControlMessage msg, int timeout_ms = 5000);
  void send(const pb::ControlMessage& msg);
  void control_loop();
  void udp_loop();
  void tcp_loop();
  void dispatch(const pb::DataMessage& msg);
  pb::ConfigResult set_value(const std::string& key, pb::Value value);

  std::string host_;
  int control_port_;
  std::string client_name_;
  int ws_fd_ = -1, udp_fd_ = -1, tcp_fd_ = -1;
  std::atomic<bool> connected_{false}, closing_{false};
  std::thread control_thread_, udp_thread_, tcp_thread_;

  pb::DeviceInfo device_;
  pb::Capabilities capabilities_;
  mutable std::mutex config_mutex_;
  pb::DeviceConfig config_;
  uint32_t client_id_ = 0;
  int tcp_port_ = 0;
  int64_t clock_offset_ns_ = 0;

  std::mutex send_mutex_;
  std::mutex pending_mutex_;
  std::condition_variable pending_cv_;
  std::map<uint64_t, pb::ControlMessage> replies_;
  uint64_t next_request_id_ = 1;

  mutable std::mutex stats_mutex_;
  std::map<std::string, StreamStats> stats_;

  std::function<void(const pb::PoseSample&)> on_pose_;
  std::function<void(const pb::ImuSample&)> on_imu_;
  std::function<void(const pb::VideoFrame&)> on_video_;
  std::function<void(const pb::DepthFrame&)> on_depth_;
  std::function<void(const pb::DeviceConfig&)> on_config_;
};

}  // namespace imuninn
