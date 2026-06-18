# YTClipV2

Initial implementation for the pipeline described in `PRD.md`.

## Prerequisites
- Python 3.10+
- Node.js 18+
- `yt-dlp` installed (`pip install yt-dlp`) or binary in PATH
- `ffmpeg` in PATH
- Ollama running locally at `http://127.0.0.1:11434`
- Surfagent running locally for video research mode (`npm install -g surfagent`, then `surfagent start`)
- `edge-tts` Python library for OG clip narration (`pip install -r requirements.txt`)

## Setup
1. Python dependencies:
   - `pip install -r requirements.txt`
2. Node dependencies:
   - `npm install`
3. Configure:
   - Copy `.env.example` to `.env` and fill values if needed.
   - Optional on Windows: set `FFMPEG_PATH` in `.env` if ffmpeg is not on PATH.
   - YouTube bot checks: `config.json` defaults to `download.cookiesFromBrowser: "firefox"` so `yt-dlp` can use your Firefox session cookies.

## Usage
- Research videos by keyword:
  - `node main.js --research "fast leveling gaming guide"`
- After reviewing `data/video-research-review.md`, generate clip timestamps for a ranked video:
  - `node main.js --use-researched 1`
- After reviewing `data/clips-review.md`, extract/render that ranked video:
  - `node main.js --use-researched 1 --approved`
- Run transcript + clip selection:
  - `node main.js <youtube_url>`
- After reviewing `data/clips-review.md`, continue:
  - `node main.js <youtube_url> --approved`
- `--approved` uses existing `data/clips.json` directly and skips AI selection.
- Force regenerate clips (new transcript + AI selection):
  - `node main.js <youtube_url> --reselect`
- Skip remotion render (optional):
  - `node main.js <youtube_url> --approved --skip-render`
- Music is added automatically after rendering using procedurally generated royalty-free funk beds at low volume.
- OG clips now receive Ollama-generated narration scripts spoken with Edge TTS at 15% mix volume before music runs.
- OG and styled outputs are generated as:
  - `Outputs/clip-XX-og.mp4` (clean crop + captions + Edge TTS narration)
  - `Outputs/clip-XX-yt.mp4` (full styled effects + music)
- To apply Edge TTS narration only on already-rendered OG clips:
  - `npm run og-tts`
- Optional: set `OG_TTS_SUMMARY_MODEL` in `.env` to use a different Ollama model for narration scripts.
- To apply music only on already-rendered clips:
  - `npm run music`
- Music volume can be tuned in `config.json`:
  - `music.style` is currently `procedural-funk`.
  - `music.minVolume` controls the quietest generated music bed.
  - `music.maxVolume` controls the loudest generated music bed.
  - Current default range is `0.22` to `0.34`.

## Research Mode
- Surfagent gathers YouTube search result candidates through its local browser API.
- Gemma ranks those candidates and writes:
  - `data/candidates.json`
  - `data/researched-videos.json`
  - `data/video-research-review.md`
- The pipeline does not download or clip researched videos until you choose one with `--use-researched`.

## YouTube Download Cookies
- If YouTube asks `yt-dlp` to sign in or says you are not a bot, keep Firefox open and logged into YouTube.
- The downloader uses `--cookies-from-browser firefox` by default.
- To use another browser, change `download.cookiesFromBrowser` in `config.json` or set `YTDLP_COOKIES_FROM_BROWSER`.
- Long videos are section-downloaded by default (`download.directClipDownload: true`), so the pipeline downloads only approved timestamp ranges instead of the full podcast.
- `download.maxHeight` defaults to `1080` for high-quality section downloads.
