import json
import os
import re
import sys
from urllib.parse import parse_qs, urlparse

from youtube_transcript_api import YouTubeTranscriptApi


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, "data")
TRANSCRIPT_PATH = os.path.join(DATA_DIR, "transcript.json")


def extract_video_id(value: str) -> str:
    if not value:
        raise ValueError("A YouTube URL or video ID is required.")

    if re.fullmatch(r"[a-zA-Z0-9_-]{11}", value):
        return value

    parsed = urlparse(value)
    if parsed.netloc in ("youtu.be", "www.youtu.be"):
        video_id = parsed.path.strip("/")
        if video_id:
            return video_id

    query = parse_qs(parsed.query)
    if "v" in query and query["v"]:
        return query["v"][0]

    raise ValueError("Could not determine YouTube video ID from input.")


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python python/transcript.py <youtube_url_or_video_id>")

    source = sys.argv[1]
    video_id = extract_video_id(source)

    os.makedirs(DATA_DIR, exist_ok=True)

    transcript_api = YouTubeTranscriptApi()
    fetched = transcript_api.fetch(video_id)
    transcript = fetched.to_raw_data()
    output = {
        "video_id": video_id,
        "source": source,
        "segments": [
            {
                "start": round(segment["start"], 3),
                "duration": round(segment["duration"], 3),
                "end": round(segment["start"] + segment["duration"], 3),
                "text": segment["text"].strip(),
            }
            for segment in transcript
            if segment["text"].strip()
        ],
    }

    with open(TRANSCRIPT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Transcript saved: {TRANSCRIPT_PATH}")


if __name__ == "__main__":
    main()
