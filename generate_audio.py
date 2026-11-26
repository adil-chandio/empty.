import numpy as np
import wave

sr = 48000
dur = 30
t = np.linspace(0, dur, int(sr * dur), False)

# Ambient drone chord
drone = 0.12 * (np.sin(2 * np.pi * 55 * t) +
                np.sin(2 * np.pi * 82.4 * t) +
                np.sin(2 * np.pi * 110 * t))

# Heartbeat kick at 60 BPM
hb = np.zeros_like(t)
bi = sr  # 1 beat per second
for i in range(int(dur)):
    s = int(i * bi)
    e = min(s + int(0.16 * sr), len(t))
    bt = np.linspace(0, 0.16, e - s)
    hb[s:e] += 0.34 * np.sin(2 * np.pi * 55 * bt) * np.exp(-bt * 15)

a = np.clip(drone + hb, -1, 1)

with wave.open('audio.wav', 'wb') as wf:
    wf.setnchannels(1)
    wf.setsampwidth(2)
    wf.setframerate(sr)
    wf.writeframes((a * 32767).astype(np.int16).tobytes())

print('audio.wav generated:', dur, 'seconds')
