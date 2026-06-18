const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const TRANSCRIPT_PATH = path.join(DATA_DIR, "transcript.json");
const CLIPS_PATH = path.join(DATA_DIR, "clips.json");
const REVIEW_PATH = path.join(DATA_DIR, "clips-review.md");
const CONFIG_PATH = path.join(ROOT, "config.json");

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function normalizeClips(payload) {
  if (!payload || !Array.isArray(payload.clips)) {
    throw new Error("Gemma response missing `clips` array.");
  }

  return {
    clips: payload.clips
      .map((clip) => ({
        start: Number(clip.start),
        end: Number(clip.end),
        hook: String(clip.hook || "").trim(),
        title: String(clip.title || "").trim(),
      }))
      .filter(
        (clip) =>
          Number.isFinite(clip.start) &&
          Number.isFinite(clip.end) &&
          clip.end > clip.start &&
          clip.hook.length > 0 &&
          clip.title.length > 0,
      ),
  };
}

function buildTranscriptWindows(transcriptPayload) {
  const segments = Array.isArray(transcriptPayload.segments)
    ? transcriptPayload.segments
    : [];
  const windowSizeSeconds = 90;
  const maxWindows = 40;
  const windows = [];

  for (const segment of segments) {
    const start = Number(segment.start);
    const end = Number(segment.end);
    const text = String(segment.text || "").replace(/\s+/g, " ").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || !text) continue;

    const index = Math.floor(start / windowSizeSeconds);
    if (!windows[index]) {
      windows[index] = {
        start: index * windowSizeSeconds,
        end: (index + 1) * windowSizeSeconds,
        text: "",
      };
    }
    windows[index].text += `${text} `;
  }

  return windows
    .filter(Boolean)
    .map((window) => ({
      start: Number(window.start.toFixed(3)),
      end: Number(window.end.toFixed(3)),
      text: window.text.replace(/\s+/g, " ").trim().slice(0, 1600),
    }))
    .filter((window) => window.text.length > 0)
    .slice(0, maxWindows);
}

function parseJsonObject(rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) {
    throw new Error("Ollama returned an empty response.");
  }

  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      return JSON.parse(fenced[1].trim());
    }

    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      throw new Error("Could not parse JSON object from Ollama response.");
    }

    return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
  }
}

async function requestOllamaJson(endpoint, model, prompt, temperature) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: "json",
      options: { temperature },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama error ${response.status}: ${text}`);
  }

  const body = await response.json();
  return parseJsonObject(body.response);
}

async function callOllama(model, host, transcriptPayload, maxClips) {
  const endpoint = `${host.replace(/\/$/, "")}/api/generate`;
  const compactTranscript = {
    video_id: transcriptPayload.video_id,
    source: transcriptPayload.source,
    windows: buildTranscriptWindows(transcriptPayload),
  };
  const prompt = [
    "You are an expert short-form video producer.",
    "Given the timestamped transcript windows, select high-engagement clips.",
    `Pick up to ${maxClips} clips.`,
    "Return only a valid JSON object in this format:",
    '{"clips":[{"start":120,"end":135,"hook":"...","title":"..."}]}',
    "Rules:",
    "- start/end must be seconds numbers",
    "- each clip should usually be 20 to 60 seconds",
    "- prefer surprising, funny, controversial, emotional, or high-context moments",
    "- hook/title must be concise and compelling",
    "- no additional keys",
    "- do not use markdown",
    "",
    "Transcript windows:",
    JSON.stringify(compactTranscript),
  ].join("\n");

  let lastError = null;
  for (const temperature of [0.1, 0]) {
    try {
      return await requestOllamaJson(endpoint, model, prompt, temperature);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function writeReviewMarkdown(clips, transcript) {
  const lines = [
    "# Clip Review",
    "",
    "Verify the clips below before extraction.",
    "",
    `Video ID: ${transcript.video_id}`,
    "",
  ];

  clips.forEach((clip, index) => {
    lines.push(`## ${index + 1}. ${clip.title}`);
    lines.push(`- Start: ${clip.start}s`);
    lines.push(`- End: ${clip.end}s`);
    lines.push(`- Hook: ${clip.hook}`);
    lines.push("");
  });

  await fs.writeFile(REVIEW_PATH, lines.join("\n"), "utf8");
}

async function main() {
  const transcript = await readJson(TRANSCRIPT_PATH);
  const config = await readJson(CONFIG_PATH);
  const model = process.argv[2] || config.ollama?.model || "gemma3:4b";
  const host = config.ollama?.host || "http://127.0.0.1:11434";
  const maxClips = Number(process.argv[3] || 5);

  const aiPayload = await callOllama(model, host, transcript, maxClips);
  const normalized = normalizeClips(aiPayload);
  if (!normalized.clips.length) {
    throw new Error("No valid clips returned from model.");
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CLIPS_PATH, JSON.stringify(normalized, null, 2), "utf8");
  await writeReviewMarkdown(normalized.clips, transcript);

  console.log(`Clips JSON saved: ${CLIPS_PATH}`);
  console.log(`Review markdown saved: ${REVIEW_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
