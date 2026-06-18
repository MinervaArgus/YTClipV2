# YT Clipper - System Prompt & Guidelines

This project is a reusable, modular, and cheap content engine for clipping YouTube videos into shorts.

## 🎯 Final Stack
- **Intelligence Layer**: Gemma 4 through Ollama API (127.0.0.1:11434) (Clip selection, hooks, reasoning)
- **Transcript Layer**: `youtube-transcript-api` (Input: YouTube URL, Output: timestamped transcript JSON)
- **Extraction Layer**: `yt-dlp` + FFmpeg (Download + cut clips automatically)
- **Rendering Layer**: Remotion + Node.js (Captions, motion, vertical formatting)

## 🔗 Pipeline & Workflow
1. **Input**: YouTube URL.
2. **Transcript Generation**: Python (`youtube-transcript-api`) fetches the transcript and outputs clean JSON.
3. **AI Selection**: Gemma 4 reads the transcript JSON and outputs selected clips (timestamps + hooks).
4. **User Verification**: Transcripts and timestamps **MUST** first be outputted in an `.md` file for the user to check before proceeding.
5. **Download & Extraction**: After user approval, Node.js calls `yt-dlp` to download the video, and `FFmpeg` to cut the clips automatically based on the JSON timestamps.
6. **Rendering**: Node.js passes the clips to Remotion, which renders the final vertical shorts with captions and motion graphics.

## 📁 Project Structure
Keep the structure clean and minimal. The following directories must be present/created:
```text
project_root/
├── python/
│   └── transcript.py       # Fetches transcript, outputs clean JSON
├── data/
│   ├── transcript.json     # Raw transcript output from Python
│   └── clips.json          # Structured clips JSON from Gemma 4
├── video/
│   └── full.mp4            # Full video downloaded by yt-dlp
├── assets/                 # Clipped YouTube videos cut by FFmpeg
├── Outputs/                # Final rendered Remotion videos
├── projects/               # Individual Remotion projects
├── remotion/               # Global Remotion components
├── scripts/
│   ├── extract.js          # Node wrapper calling yt-dlp & FFmpeg
│   └── render.js           # Node script triggering Remotion
└── main.js                 # App orchestrator
```

## ⚙️ Responsibility Split
- **Python side**: Responsible exclusively for fetching transcripts and outputting clean JSON.
- **Gemma 4 step**: Responsible for taking the transcript as input and outputting `clips.json`.
- **Node.js side**: Responsible for running infrastructure (yt-dlp, FFmpeg, Remotion).

## 🔥 Critical Design Decisions
- **NO Markdown for Timestamps in final pipeline**: Always use structured JSON. This ensures FFmpeg and Remotion can consume it without manual work.
- **Example Data Structure (`clips.json`)**:
  ```json
  {
    "clips": [
      {
        "start": 120,
        "end": 135,
        "hook": "This is why most people fail",
        "title": "Discipline Truth"
      }
    ]
  }
  ```

## 🔑 Environment Variables & API Keys
Store all sensitive credentials in a `.env` file at the root of the project. Make sure this file is ignored by git.

```env
# ElevenLabs Configuration (Optional)
ELEVENLABS_API_KEY=your_api_key_here
```
*Note: The Voice ID is not a sensitive API key, so it is permanently stored in `config.json` instead of the `.env` file for easy access across all scripts.*

## ⚠️ Additional Rules & Constraints
- **Exclusions**: Do NOT use Playwright. Do NOT build manual upload/download steps.
- **Optional features**: ElevenLabs can be integrated for AI voiceovers. Ensure scripts securely pull the `ELEVENLABS_API_KEY` from the `.env` file, and read the chosen Voice ID directly from `config.json`.
- **Folder Management**: Ensure `Outputs/`, `projects/`, and `assets/` folders are created and strictly used for their respective purposes.
- **Mandatory Review**: Gemma 4 MUST create a `.md` file containing the generated timestamps and excerpts for the user to approve before initiating video downloads or FFmpeg cuts.
