const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
require("dotenv").config();

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "Outputs");
const CLEAN_OG_DIR = path.join(OUTPUT_DIR, "clean-og");
const CLIPS_PATH = path.join(ROOT, "data", "clips.json");
const CONFIG_PATH = path.join(ROOT, "config.json");
const TTS_VOLUME = 0.15;
const DEFAULT_VOICE = process.env.EDGE_TTS_VOICE || "en-US-AriaNeural";
const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_PATH,
  "ffmpeg",
  "ffmpeg.exe",
  path.join(ROOT, "ffmpeg", "bin", "ffmpeg.exe"),
  "C:\\ffmpeg\\bin\\ffmpeg.exe",
  "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
  "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
].filter(Boolean);

function sanitizeText(value) {
  return String(value || "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text) {
  return sanitizeText(text)
    .split(/\s+/)
    .filter(Boolean).length;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFileBusyError(error) {
  const code = String(error?.code || "");
  if (code === "EPERM" || code === "EBUSY" || code === "EACCES") return true;
  const message = String(error?.message || "");
  return /EPERM|EBUSY|EACCES|operation not permitted/i.test(message);
}

async function replaceFileWithRetries(sourcePath, destinationPath) {
  let lastError = null;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    try {
      await fs.rm(destinationPath, { force: true }).catch(() => null);
      await fs.rename(sourcePath, destinationPath);
      return;
    } catch (error) {
      lastError = error;
      if (!isFileBusyError(error)) throw error;
      await wait(120 + attempt * 80);
    }
  }

  try {
    await fs.copyFile(sourcePath, destinationPath);
    await fs.rm(sourcePath, { force: true }).catch(() => null);
    return;
  } catch (error) {
    lastError = error;
  }

  throw new Error(
    `Could not replace ${path.basename(destinationPath)} because it appears to be locked. Close players/editors using this file and retry. Last error: ${String(lastError?.message || lastError)}`,
  );
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `Required command not found: ${command}. Install it and ensure it is available in PATH.`,
          ),
        );
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function runFfmpeg(args) {
  let commandNotFoundError = null;
  for (const candidate of FFMPEG_CANDIDATES) {
    try {
      await runCommand(candidate, args);
      return;
    } catch (error) {
      const message = String(error?.message || "");
      if (message.includes("Required command not found:")) {
        commandNotFoundError = error;
        continue;
      }
      throw error;
    }
  }

  if (commandNotFoundError) {
    throw new Error(
      "FFmpeg was not found. Set FFMPEG_PATH in your .env or install ffmpeg and add it to PATH.",
    );
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function buildFallbackSummaryText(clip) {
  const title = sanitizeText(clip?.title || "");
  const hook = sanitizeText(clip?.hook || "");
  const condensedHook = hook
    .split(/\s+/)
    .slice(0, 26)
    .join(" ")
    .trim();

  const pieces = [];
  if (title) pieces.push(`Summary: ${title}.`);
  if (condensedHook) {
    pieces.push(condensedHook.endsWith(".") ? condensedHook : `${condensedHook}.`);
  }
  if (pieces.length === 0) {
    return "Summary: Highlight moment from this clip.";
  }
  return pieces.join(" ");
}

async function requestOllamaText(host, model, prompt, temperature = 0.6) {
  const endpoint = `${host.replace(/\/$/, "")}/api/generate`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama error ${response.status}: ${text}`);
  }

  const body = await response.json();
  return sanitizeText(body.response || "");
}

function getTargetWords(durationSeconds) {
  // Empirically tuned so generated narration is closer to full clip runtime.
  const wordsPerSecond = 2.85;
  return Math.max(24, Math.round(durationSeconds * wordsPerSecond));
}

async function generateSummaryWithOllama(clip, durationSeconds, model, host) {
  const title = sanitizeText(clip?.title || "Untitled clip");
  const hook = sanitizeText(clip?.hook || "");
  const targetWords = getTargetWords(durationSeconds);
  const minWords = Math.max(18, Math.floor(targetWords * 0.88));
  const maxWords = Math.ceil(targetWords * 1.12);

  const prompt = [
    "You are writing narration for a short-form video clip.",
    "Return ONLY narration text as one paragraph. No markdown. No quotes. No bullet points.",
    `Write approximately ${targetWords} words (acceptable range ${minWords}-${maxWords}) so the voiceover lasts close to the full clip length.`,
    "Make it engaging, concise, and conversational without adding fake facts.",
    "",
    `Clip title: ${title}`,
    `Clip hook/context: ${hook || "N/A"}`,
  ].join("\n");

  const firstPass = await requestOllamaText(host, model, prompt, 0.6);
  if (countWords(firstPass) >= minWords) {
    return firstPass;
  }

  const expandPrompt = [
    "Expand this narration to better fit the target duration while keeping facts consistent.",
    "Return ONLY narration text as one paragraph.",
    `Target words: about ${targetWords} (minimum ${minWords}).`,
    "",
    firstPass,
  ].join("\n");
  const secondPass = await requestOllamaText(host, model, expandPrompt, 0.65);
  return countWords(secondPass) >= countWords(firstPass) ? secondPass : firstPass;
}

async function synthesizeEdgeTtsToFile(voice, text, outputPath) {
  const args = [
    "-m",
    "edge_tts",
    "--voice",
    voice,
    "--text",
    text,
    "--rate",
    "-4%",
    "--write-media",
    outputPath,
  ];
  try {
    await runCommand("python", args);
  } catch (error) {
    const message = String(error?.message || error);
    if (/No module named edge_tts|ModuleNotFoundError|exited with code/i.test(message)) {
      throw new Error(
        `edge-tts is not installed or failed to run. Install Python deps with \`pip install -r requirements.txt\`. Original error: ${message}`,
      );
    }
    throw error;
  }
}

function parseClipIndex(fileName) {
  const match = String(fileName).match(/^clip-(\d+)-og\.mp4$/i);
  if (!match) return null;
  const idx = Number(match[1]) - 1;
  return Number.isInteger(idx) && idx >= 0 ? idx : null;
}

async function mixTtsIntoOgClip(sourcePath, outputPath, ttsPath) {
  const tempOutput = outputPath.replace(/\.mp4$/i, ".tts-tmp.mp4");
  const withSourceAudioArgs = [
    "-y",
    "-i",
    sourcePath,
    "-i",
    ttsPath,
    "-filter_complex",
    `[1:a]volume=${TTS_VOLUME},afade=t=in:st=0:d=0.4[tts];[0:a][tts]amix=inputs=2:duration=first:weights=1 1:normalize=0[aout]`,
    "-map",
    "0:v:0",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    tempOutput,
  ];
  const ttsOnlyFallbackArgs = [
    "-y",
    "-i",
    sourcePath,
    "-i",
    ttsPath,
    "-filter_complex",
    `[1:a]volume=${TTS_VOLUME},afade=t=in:st=0:d=0.4[aout]`,
    "-map",
    "0:v:0",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    tempOutput,
  ];

  try {
    try {
      await runFfmpeg(withSourceAudioArgs);
    } catch {
      await runFfmpeg(ttsOnlyFallbackArgs);
    }
    await replaceFileWithRetries(tempOutput, outputPath);
  } finally {
    await fs.rm(tempOutput, { force: true }).catch(() => null);
  }
}

async function main() {
  const config = await readJson(CONFIG_PATH).catch(() => ({}));
  const clipsPayload = await readJson(CLIPS_PATH).catch(() => ({ clips: [] }));
  const clips = Array.isArray(clipsPayload.clips) ? clipsPayload.clips : [];
  const ollamaHost =
    process.env.OLLAMA_HOST || config.ollama?.host || "http://127.0.0.1:11434";
  const ollamaModel =
    process.env.OG_TTS_SUMMARY_MODEL ||
    process.env.OLLAMA_MODEL ||
    config.ollama?.model ||
    "gemma3:4b";
  const cleanOgFiles = await fs.readdir(CLEAN_OG_DIR).catch(() => []);
  const outputFiles = await fs.readdir(OUTPUT_DIR).catch(() => []);
  const sourceDir = cleanOgFiles.some((file) => /^clip-\d+-og\.mp4$/i.test(file))
    ? CLEAN_OG_DIR
    : OUTPUT_DIR;
  const files = sourceDir === CLEAN_OG_DIR ? cleanOgFiles : outputFiles;
  const ogFiles = files
    .filter((file) => /^clip-\d+-og\.mp4$/i.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (ogFiles.length === 0) {
    console.log("No OG clip files found for TTS narration.");
    return;
  }

  for (const file of ogFiles) {
    const clipIndex = parseClipIndex(file);
    const clip = clipIndex === null ? null : clips[clipIndex];
    const durationSeconds =
      clip && Number.isFinite(Number(clip.end)) && Number.isFinite(Number(clip.start))
        ? Math.max(6, Number(clip.end) - Number(clip.start))
        : 45;
    let summary = "";
    try {
      summary = await generateSummaryWithOllama(
        clip,
        durationSeconds,
        ollamaModel,
        ollamaHost,
      );
    } catch (error) {
      console.warn(
        `Ollama summary generation failed for ${file}; using fallback summary. Reason: ${String(error?.message || error)}`,
      );
      summary = buildFallbackSummaryText(clip);
    }
    const sourcePath = path.join(sourceDir, file);
    const outputPath = path.join(OUTPUT_DIR, file);
    const ttsPath = outputPath.replace(/\.mp4$/i, ".edge-tts.mp3");

    console.log(
      `Synthesizing Edge TTS for ${file} using Ollama summary (${countWords(summary)} words)...`,
    );
    await synthesizeEdgeTtsToFile(DEFAULT_VOICE, summary, ttsPath);
    console.log(`Mixing TTS into ${file} at ${Math.round(TTS_VOLUME * 100)}% volume...`);
    try {
      await mixTtsIntoOgClip(sourcePath, outputPath, ttsPath);
    } finally {
      await fs.rm(ttsPath, { force: true }).catch(() => null);
    }
  }

  console.log("Edge TTS narration added to OG clips.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
