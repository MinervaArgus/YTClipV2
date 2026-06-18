const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const VIDEO_DIR = path.join(ROOT, "video");
const ASSETS_DIR = path.join(ROOT, "assets");

const CLIPS_PATH = path.join(DATA_DIR, "clips.json");
const CONFIG_PATH = path.join(ROOT, "config.json");
const VIDEO_PATH = path.join(VIDEO_DIR, "full.mp4");

function resolveCommand(command) {
  if (process.platform === "win32") {
    if (command === "yt-dlp") return "yt-dlp.exe";
  }
  return command;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveCommand(command), args, { stdio: "inherit" });
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `Required command not found: ${command}. Install it and ensure it is in PATH.`,
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

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function buildDownloadArgs(url, config, outputPath = VIDEO_PATH, section = null) {
  const downloadConfig = config.download || {};
  const maxHeight = Number(downloadConfig.maxHeight || 720);
  const args = [
    "--force-overwrites",
    "--no-part",
    "--merge-output-format",
    "mp4",
    "--format-sort",
    `res:${maxHeight},vcodec:h264,acodec:aac`,
    "-f",
    `bv*[height<=${maxHeight}][ext=mp4]+ba[ext=m4a]/b[height<=${maxHeight}][ext=mp4]/best`,
    "--js-runtimes",
    downloadConfig.jsRuntime || "node",
  ];

  if (downloadConfig.remoteComponents) {
    args.push("--remote-components", downloadConfig.remoteComponents);
  }

  const cookiesFromBrowser =
    process.env.YTDLP_COOKIES_FROM_BROWSER ||
    downloadConfig.cookiesFromBrowser;
  if (cookiesFromBrowser) {
    args.push("--cookies-from-browser", cookiesFromBrowser);
  }

  if (section) {
    args.push("--download-sections", section, "--force-keyframes-at-cuts");
  }

  args.push("-o", outputPath, url);
  return args;
}

async function runYtDlp(ytDlpArgs) {
  try {
    await runCommand("yt-dlp", ytDlpArgs);
  } catch (error) {
    const message = String(error?.message || "");
    if (!message.includes("Required command not found: yt-dlp")) {
      throw error;
    }

    // Fallback: many setups have yt-dlp installed as a Python module.
    try {
      await runCommand("python", ["-m", "yt_dlp", ...ytDlpArgs]);
    } catch {
      throw new Error(
        "yt-dlp is required but was not found. Install it with `pip install yt-dlp` or install the yt-dlp binary and add it to PATH.",
      );
    }
  }
}

async function downloadVideo(url, config) {
  await fs.mkdir(VIDEO_DIR, { recursive: true });
  await runYtDlp(buildDownloadArgs(url, config));
}

async function downloadClipSection(url, config, start, end, outputPath) {
  const safeStart = Math.max(0, Number(start));
  const safeEnd = Math.max(safeStart + 0.1, Number(end));
  const section = `*${safeStart.toFixed(3)}-${safeEnd.toFixed(3)}`;
  await runYtDlp(buildDownloadArgs(url, config, outputPath, section));
}

async function extractClip(start, end, outputPath) {
  const duration = Math.max(0.1, end - start).toFixed(3);
  const ffmpegArgs = [
    "-y",
    "-i",
    VIDEO_PATH,
    "-ss",
    String(start),
    "-t",
    String(duration),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "21",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    outputPath,
  ];
  try {
    await runCommand("ffmpeg", ffmpegArgs);
  } catch (error) {
    const message = String(error?.message || "");
    if (!message.includes("Required command not found: ffmpeg")) {
      throw error;
    }
    await runCommand("ffmpeg.exe", ffmpegArgs);
  }
}

async function main() {
  const sourceUrl = process.argv[2];
  if (!sourceUrl) {
    throw new Error("Usage: node scripts/extract.js <youtube_url>");
  }

  const clipsPayload = await readJson(CLIPS_PATH);
  const config = await readJson(CONFIG_PATH).catch(() => ({}));
  if (!Array.isArray(clipsPayload.clips) || clipsPayload.clips.length === 0) {
    throw new Error("No clips found in data/clips.json");
  }

  await fs.mkdir(ASSETS_DIR, { recursive: true });
  const directClipDownload = config.download?.directClipDownload !== false;

  for (let i = 0; i < clipsPayload.clips.length; i += 1) {
    const clip = clipsPayload.clips[i];
    const fileName = `clip-${String(i + 1).padStart(2, "0")}.mp4`;
    const outputPath = path.join(ASSETS_DIR, fileName);
    if (directClipDownload) {
      console.log(`Downloading section ${clip.start}s-${clip.end}s to ${fileName}...`);
      await downloadClipSection(sourceUrl, config, clip.start, clip.end, outputPath);
    } else {
      if (i === 0) {
        await downloadVideo(sourceUrl, config);
      }
      await extractClip(clip.start, clip.end, outputPath);
    }
  }

  console.log("Clip extraction complete.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
