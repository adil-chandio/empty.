# TABAHI — Next Level 3D Animation

> "पहले dekho, research karo, analyze karo, explore karo deeply — microscope lagake 10x think leke."  
> A premium, storytelling-driven 3D animation where **every frame hooks, engages, and hypnotizes** the audience. Zero flaws. Tabahi level.

## What this is
A complete, code-built 3D cinematic experience:
- **Three.js** real-time animation (runs in browser — live preview ready)
- **Web Audio API** synthesized SFX / ambient / eargasm audio (no external files)
- **Story timeline** with 15 psychology-driven beats
- **Cinematic post-processing**: bloom, vignette, color grade, film grain, chromatic aberration
- **Blender Python script** (`blender_render.py`) to render the real MP4 offline
- **Storyboard** (`STORYBOARD.md`) with full beat-by-beat creative direction

## Stack
| Layer | Tech |
|-------|------|
| 3D Engine | Three.js r166 (WebGL) |
| Audio | Web Audio API (fully synthesized) |
| Post-processing | EffectComposer + UnrealBloomPass + custom shaders |
| Offline render | Blender Python (bpy) + FFmpeg |
| Server | http-server (Node) |

## Quick start

```bash
# 1. Install deps
npm install

# 2. Start live preview
npm run dev
# → opens the live preview URL (Arena proxies it)

# 3. Click anywhere in the preview to unlock audio & begin
```

### Render a real MP4 video (offline)
Requires **Blender** and **FFmpeg** on your machine (not installed in this sandbox):

```bash
# In Blender (Scripting tab) or headless:
blender -b -P blender_render.py

# Render frames:
blender -b scene.blend -a

# Stitch to MP4:
ffmpeg -framerate 60 -i frames/%04d.png -i audio.wav \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest tabahi.mp4
```

## Story structure (30 s, loopable, 15 beats)

See `STORYBOARD.md` for the full table. Highlights:
- 0–2s: The Hook (symmetrical frozen city)
- 2–3.5s: The First Crack (pattern interrupt)
- 11–13s: Neon Surge (eargasm sub-drop + shimmer)
- 13–15s: The Break (city splits, debris flies)
- 17–19s: Zero-G Dance (hypnotic floating)
- 27–30s: Loop Point (return to symmetry, rewatchable)

## Psychology applied
1. **Pattern interrupt** — symmetry breaks early to re-orient attention.
2. **Mirror neurons** — expressive faces make viewers feel the emotion.
3. **Anticipation → release** — risers before drops = dopamine payoff.
4. **Novelty / awe** — physics violations (folding buildings, zero-G).
5. **Closure** — reassembly resolves tension, satisfies the brain.
6. **Eargasm** — 10–14 kHz air shimmer + sub-bass = physical pleasure.
7. **Hypnotic loop** — symmetrical start/end invites re-watch.

## Customize
- **Colors / theme:** edit `CONFIG.COLORS` in `js/app.js`
- **Story timing / beats:** edit `BEATS` array in `js/app.js`
- **Audio:** `js/audio.js` — all synthesized; tweak frequencies/gain
- **Blender render:** `blender_render.py` mirrors the same story beats

## License
MIT — built by adil-chandio. Premium. Top-notch. Cinema level.
