# Microphone audio

From protocol v6 the phone can send the microphone as the `audio` stream (iOS only for now). It is off by default; iOS asks for microphone permission the first time it is turned on.

```python
import imuninn
from imuninn.audio import to_numpy, frame_times_ns, level_dbfs

with imuninn.connect("10.0.0.5") as dev:
    dev.set("audio.enabled", True)
    dev.set("audio.sample_rate", "16000")     # selectable like the video formats, see below
    dev.start()
    for chunk in dev.iter("audio"):
        x = to_numpy(chunk)                   # float32 (frames, channels), -1..1
        t = frame_times_ns(chunk)             # device time of every frame (ns)
        print(f"{level_dbfs(chunk):.1f} dBFS")
```

## Parameters

| parameter | values | default | notes |
| --- | --- | --- | --- |
| `audio.enabled` | bool | `false` | on / off |
| `audio.sample_rate` | `8000` `16000` `22050` `24000` `32000` `44100` `48000` | `48000` | Hz; speech recognition usually wants 16000 |
| `audio.sample_format` | `s16` / `f32` | `s16` | 16-bit integer or 32-bit float PCM, little-endian |
| `audio.chunk_ms` | 10–200 | 20 | duration of one message; shorter = lower latency, more messages |
| `audio.processing` | `raw` / `voice` | `raw` | `raw` = iOS measurement mode, no AGC / noise suppression, for acoustic detection; `voice` = system voice processing (AGC, noise suppression, echo cancellation) |

Changing these restarts only the microphone, never the camera. Mono; `AudioChunk.channels` is there for stereo later.

Bandwidth: about 768 kbit/s at 48 kHz s16, 256 kbit/s at 16 kHz s16, far below the video.

## Time and synchronisation

`header.device_time_ns` of every `AudioChunk` is the capture time of the **first frame in the chunk** (the input latency reported by the system is subtracted), on the same device clock as video, IMU and pose (the iOS mach time base); frame `i` is at `device_time_ns + i * 1e9 / sample_rate`. Audio therefore lines up with the other streams by timestamp alone; use `dev.to_pc_time_ns()` for PC time.

Consecutive chunks advance by sample count and are re-anchored to the system clock when the two drift apart by more than 2 ms. A gap in `header.seq` means a lost chunk (only on overload or a restart).

## Transport

Like depth it goes over TCP (the second WebSocket for browsers) and is **never dropped**: a missing chunk is an audible click. Under congestion the video drops non-key frames first.

## Recording and export

- Phone-side recordings and `imuninn record` include audio (MCAP topic `/audio`, message `AudioChunk`).
- Export to WAV:

```bash
imuninn record --start --audio -o run1.mcap
imuninn export-audio run1.mcap -o run1.wav       # phone .imuninn recordings work too
```

The WAV keeps the stream's format (s16 → 16-bit PCM, f32 → 32-bit float); lost chunks are filled with silence, so sample 0 of the WAV is at the device time the command prints and every later sample follows at the sample rate.

## Rerun and the browser

- Rerun cannot play sound: `imuninn rerun` plots the RMS level of each chunk at `plots/<device>/audio/level` (dBFS).
- The browser viewer plays it live (press "Play sound" in the audio card; browsers need a click first) and draws the level; MCAP replay plays it too.
