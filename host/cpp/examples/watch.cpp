// imuninn_watch <host> [seconds]: connect, start, print rates and a few samples.
#include <atomic>
#include <chrono>
#include <cstdio>
#include <thread>

#include "imuninn/client.hpp"

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: imuninn_watch <phone-host> [seconds]\n");
    return 2;
  }
  int seconds = argc > 2 ? std::atoi(argv[2]) : 5;
  imuninn::Client client(argv[1]);
  std::atomic<int> poses{0}, imus{0}, videos{0}, depths{0};
  client.on_pose([&](const imuninn::pb::PoseSample& p) {
    if (poses++ % 60 == 0)
      std::printf("pose seq=%llu t=%.3f p=(%+.3f %+.3f %+.3f) tracking=%d\n", (unsigned long long)p.header().seq(),
                  p.header().device_time_ns() / 1e9, p.position().x(), p.position().y(), p.position().z(), p.tracking());
  });
  client.on_imu([&](const imuninn::pb::ImuSample& s) {
    if (imus++ % 100 == 0)
      std::printf("imu  seq=%llu a=(%+.2f %+.2f %+.2f)\n", (unsigned long long)s.header().seq(), s.accel().x(), s.accel().y(), s.accel().z());
  });
  client.on_video([&](const imuninn::pb::VideoFrame& v) {
    if (videos++ % 60 == 0)
      std::printf("rgb  seq=%llu %ux%u %s %zu B\n", (unsigned long long)v.header().seq(), v.width(), v.height(),
                  v.keyframe() ? "I" : "P", v.data().size());
  });
  client.on_depth([&](const imuninn::pb::DepthFrame& d) {
    if (depths++ % 60 == 0)
      std::printf("depth seq=%llu %ux%u %zu B\n", (unsigned long long)d.header().seq(), d.width(), d.height(), d.depth_mm().size());
  });

  client.connect();
  std::printf("connected to %s (%s), offset %.3f ms\n", client.device().device_name().c_str(),
              client.device().model().c_str(), client.clock_offset_ns() / 1e6);
  auto r = client.set("imu.rate_hz", int64_t(100));
  std::printf("set imu.rate_hz -> config v%u\n", r.config_version());
  client.start();
  std::this_thread::sleep_for(std::chrono::seconds(seconds));
  client.stop();
  for (const auto& [id, st] : client.stats())
    std::printf("%-8s %6llu samples, %llu dropped, %.1f Hz\n", id.c_str(), (unsigned long long)st.count,
                (unsigned long long)st.dropped, double(st.count) / seconds);
  client.close();
  return 0;
}
