const path = require("node:path");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
require("dotenv").config();

const ROOT = __dirname;
const CLIPS_PATH = path.join(ROOT, "data", "clips.json");
const TRANSCRIPT_PATH = path.join(ROOT, "data", "transcript.json");
const RESEARCHED_PATH = path.join(ROOT, "data", "researched-videos.json");
const REQUIRED_DIRS = [
  "python",
  "data",
  "video",
  "assets",
  "Outputs",
  "projects",
  "remotion",
  "scripts",
];

function runCommand(command, args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `Command not found: ${command}. Install it and ensure it is available in PATH.`,
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

async function clipsExistForSource(sourceUrl) {
  try {
    const [clipsRaw, transcriptRaw] = await Promise.all([
      fs.readFile(CLIPS_PATH, "utf8"),
      fs.readFile(TRANSCRIPT_PATH, "utf8"),
    ]);
    const clipsPayload = JSON.parse(clipsRaw);
    const transcriptPayload = JSON.parse(transcriptRaw);
    return (
      transcriptPayload.source === sourceUrl &&
      Array.isArray(clipsPayload.clips) &&
      clipsPayload.clips.length > 0
    );
  } catch {
    return false;
  }
}

function getFlagValue(flagName) {
  const index = process.argv.indexOf(flagName);
  if (index < 0) return null;

  const values = [];
  for (let i = index + 1; i < process.argv.length; i += 1) {
    const value = process.argv[i];
    if (value.startsWith("--")) break;
    values.push(value);
  }

  return values.join(" ").trim() || null;
}

function hasFlag(flagName) {
  return process.argv.includes(flagName);
}

async function getResearchedUrl(rankValue) {
  const rank = Number(rankValue || 1);
  if (!Number.isInteger(rank) || rank < 1) {
    throw new Error("--use-researched requires a positive rank number.");
  }

  const raw = await fs.readFile(RESEARCHED_PATH, "utf8");
  const payload = JSON.parse(raw);
  if (!Array.isArray(payload.recommended) || payload.recommended.length === 0) {
    throw new Error("No researched videos found in data/researched-videos.json.");
  }

  const selected = payload.recommended.find((video) => Number(video.rank) === rank);
  if (!selected?.url) {
    throw new Error(`No researched video found for rank ${rank}.`);
  }

  return selected.url;
}

async function ensureStructure() {
  for (const folder of REQUIRED_DIRS) {
    await fs.mkdir(path.join(ROOT, folder), { recursive: true });
  }
}

async function main() {
  const researchQuery = getFlagValue("--research");
  const useResearchedRank = getFlagValue("--use-researched");
  let sourceUrl = process.argv[2];
  const approved = process.argv.includes("--approved");
  const skipRender = process.argv.includes("--skip-render");
  const reselect = process.argv.includes("--reselect");

  await ensureStructure();

  if (hasFlag("--research") && !researchQuery) {
    throw new Error("Usage: node main.js --research <youtube_search_query>");
  }

  if (hasFlag("--use-researched") && !useResearchedRank) {
    throw new Error("Usage: node main.js --use-researched <rank> [--approved]");
  }

  if (researchQuery) {
    console.log("\n[Research 1/2] Finding candidate videos with Surfagent...");
    await runCommand("node", ["scripts/research-videos.js", researchQuery]);

    console.log("\n[Research 2/2] Ranking candidates with Gemma via Ollama...");
    await runCommand("node", ["scripts/rank-videos.js"]);

    console.log(
      "\nReview required: check data/video-research-review.md, then run `node main.js --use-researched 1 --approved`.",
    );
    return;
  }

  if (useResearchedRank) {
    sourceUrl = await getResearchedUrl(useResearchedRank);
    console.log(`\nUsing researched video rank ${useResearchedRank}: ${sourceUrl}`);
  }

  if (sourceUrl?.startsWith("--")) {
    sourceUrl = null;
  }

  if (!sourceUrl) {
    throw new Error(
      "Usage: node main.js <youtube_url> [--approved] [--skip-render] OR node main.js --research <query>",
    );
  }

  const hasExistingClips = await clipsExistForSource(sourceUrl);

  if (!approved || reselect || !hasExistingClips) {
    console.log("\n[1/4] Fetching transcript...");
    await runCommand("python", ["python/transcript.py", sourceUrl]);

    console.log("\n[2/4] Selecting clips with Gemma via Ollama...");
    await runCommand("node", ["scripts/select-clips.js"]);

    console.log(
      "\nReview required: check data/clips-review.md, then rerun with --approved to extract clips.",
    );
    return;
  } else {
    console.log(
      "\nUsing existing approved clips from data/clips.json (skipping transcript and AI selection).",
    );
  }

  console.log("\n[3/4] Downloading source and extracting clips...");
  await runCommand("node", ["scripts/extract.js", sourceUrl]);

  if (skipRender) {
    console.log("\nSkipped render step.");
    return;
  }

  console.log("\n[4/6] Rendering captioned clip outputs...");
  await runCommand("node", ["scripts/render.js"]);

  console.log("\n[5/6] Adding Edge TTS summaries to OG clips...");
  await runCommand("node", ["scripts/add-og-tts.js"]);

  console.log("\n[6/6] Adding low-volume non-copyright background music...");
  await runCommand("node", ["scripts/add-music.js"]);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
