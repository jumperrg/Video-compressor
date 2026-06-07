# Video Compressor

Node.js CLI tool that batch-compresses `.mp4` and `.mov` files using FFmpeg. Outputs platform-ready H.264 files optimized for YouTube, Instagram, and TikTok — with a review prompt after each file so you decide whether to delete the original.

---

## Requirements

- [Node.js](https://nodejs.org/) v16+
- FFmpeg is bundled via `ffmpeg-static` — no separate install needed

---

## Install

```bash
npm install
```

---

## Usage

```bash
node compress.js "D:\path\to\your\videos"
```

If no path is given, defaults to `./videos` relative to the script.

---

## Workflow

```
1. Scan target folder (recursive)
        ↓
2. Find all .mp4 and .mov files
        ↓
3. Sort by file size — largest first
        ↓
4. For each file:
   a. Compress → save as <original_name>_comp.mp4 in the same folder
   b. Show progress bar with ETA
   c. ── PAUSE ── Show original vs compressed size & savings %
   d. Prompt:
        [Enter]  keep both files, go to next
        [d]      delete the original, go to next
        [q]      stop here — all remaining originals untouched
        ↓
5. Print summary (compressed / deleted / skipped / errors)
```

> The original is **never touched** unless you explicitly press `d`. Quitting mid-run is safe — all files compressed so far keep their `_comp` output, and no originals are deleted unless you confirmed it.

---

## Output File Naming

| Original | Output |
|---|---|
| `clip.mp4` | `clip_comp.mp4` |
| `footage.mov` | `footage_comp.mov` |
| `subfolder/video.mp4` | `subfolder/video_comp.mp4` |

Output is always saved **next to the original** file.

If a `_comp` file already exists, the file is **skipped** automatically. Files whose names already end in `_comp` are **never picked up** as inputs, so previously compressed files won't be re-compressed.

---

## Encoding Settings

| Setting | Value | Why |
|---|---|---|
| Codec | H.264 (`libx264`) | Universal — accepted by YouTube, Instagram, TikTok |
| Quality | CRF 23 | Visually transparent; imperceptible difference from original |
| Preset | `slow` | Better compression ratio at the same CRF quality level |
| Profile | `high` | Required by all three platforms for full compatibility |
| Level | `4.1` | Covers up to 1080p60 |
| Pixel format | `yuv420p` | 8-bit 4:2:0 — the only format all platforms accept |
| Audio codec | AAC | Standard for MP4 containers |
| Audio bitrate | 192k | Recommended minimum for YouTube/IG/TikTok |
| Audio channels | Stereo (2ch) | Mono can be rejected or silently re-encoded by platforms |
| Sample rate | 48000 Hz | Broadcast/platform standard; avoids A/V sync drift |
| Container flag | `+faststart` | Moves metadata to file start — required for web streaming |

### Adjusting Quality

Edit the `-crf` value in [compress.js](compress.js) line ~62:

| CRF | Quality | File size |
|---|---|---|
| 18 | Near-lossless | Large |
| 23 | Visually transparent (default) | Medium |
| 28 | Noticeable compression | Small |

---

## Terminal Output Example

```
=== Video Compressor ===
Scanning: D:\videos

Found 3 file(s) to compress (largest first):

  1. [   1.84 GB] D:\videos\wedding_raw.mp4
  2. [ 420.10 MB] D:\videos\clips\travel.mov
  3. [  88.33 MB] D:\videos\clips\short.mp4

[1/3] wedding_raw.mp4
  Input:  D:\videos\wedding_raw.mp4
  Output: D:\videos\wedding_raw_comp.mp4
  Size:   1.84 GB
  Progress |████████████████░░░░| 78% | ETA: 42s | 312/400s
  Compressed in 214.3s

  Review result:
    Original :    1.84 GB  D:\videos\wedding_raw.mp4
    Compressed:  610.22 MB  D:\videos\wedding_raw_comp.mp4
    Saved     : 67.6%

  [Enter] keep both & continue   [d] delete original   [q] quit
```
