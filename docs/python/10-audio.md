# 麦克风音频

协议 v6 起，手机可以把麦克风作为流 `audio` 发出来（目前只有 iOS）。默认关闭；第一次打开时 iOS 会弹出麦克风权限请求。

```python
import imuninn
from imuninn.audio import to_numpy, frame_times_ns, level_dbfs

with imuninn.connect("10.0.0.5") as dev:
    dev.set("audio.enabled", True)
    dev.set("audio.sample_rate", "16000")     # 规格和视频一样可选，见下表
    dev.start()
    for chunk in dev.iter("audio"):
        x = to_numpy(chunk)                   # float32 (帧数, 声道)，-1..1
        t = frame_times_ns(chunk)             # 每一帧的设备时间（ns）
        print(f"{level_dbfs(chunk):.1f} dBFS")
```

## 参数

| 参数 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `audio.enabled` | bool | `false` | 开关 |
| `audio.sample_rate` | `8000` `16000` `22050` `24000` `32000` `44100` `48000` | `48000` | 采样率（Hz）；语音识别常用 16000 |
| `audio.sample_format` | `s16` / `f32` | `s16` | 16 位整数或 32 位浮点 PCM，小端 |
| `audio.chunk_ms` | 10–200 | 20 | 每条消息的时长；越短延迟越低、消息越多 |
| `audio.processing` | `raw` / `voice` | `raw` | `raw` = iOS measurement 模式，无自动增益 / 降噪，适合声学检测；`voice` = 系统语音处理（AGC、降噪、回声消除） |

改这些参数只会重启麦克风，不会打断相机。单声道；`AudioChunk.channels` 留给以后的立体声。

带宽：48 kHz s16 约 768 kbit/s，16 kHz s16 约 256 kbit/s，都远小于视频。

## 时间与同步

每条 `AudioChunk` 的 `header.device_time_ns` 是**块内第一帧**的采集时间（已减去系统报告的输入延迟），和视频、IMU、位姿同一个设备时钟（iOS 的 mach 时基）；第 `i` 帧在 `device_time_ns + i * 1e9 / sample_rate`。所以音频和其他流直接按时间戳对齐，换到 PC 时间用 `dev.to_pc_time_ns()`。

块与块之间按采样数递推，和系统时钟偏差超过 2 ms 时重新对齐。`header.seq` 断号表示丢块（只在过载或重启时发生）。

## 传输

和深度一样走 TCP（浏览器走第二条 WebSocket），**不丢**：丢一块就是一声爆音。音频优先级不高于视频，链路拥塞时视频会先丢非关键帧。

## 录制与导出

- 手机本机录制、`imuninn record` 都会包含音频（MCAP topic `/audio`，消息 `AudioChunk`）。
- 导出 WAV：

```bash
imuninn record --start --audio -o run1.mcap
imuninn export-audio run1.mcap -o run1.wav       # 也接受手机的 .imuninn 录制
```

WAV 的格式跟流一致（s16 → 16 位 PCM，f32 → 32 位浮点）；丢掉的块用静音补齐，所以 WAV 的第 0 个采样对应命令打印出的设备时间，之后严格按采样率递推。

## Rerun 与浏览器

- Rerun 不能播放声音，`imuninn rerun` 把每块的 RMS 电平画在 `plots/<设备>/audio/level`（dBFS）。
- 浏览器查看器可以实时播放（点音频卡片里的「播放声音」，浏览器要求先点一下），并显示电平曲线；MCAP 回放同样能播。
