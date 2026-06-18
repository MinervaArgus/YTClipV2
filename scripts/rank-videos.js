const fs = require("node:fs/promises");
const path = require("node:path");
require("dotenv").config();

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const CONFIG_PATH = path.join(ROOT, "config.json");
const CANDIDATES_PATH = path.join(DATA_DIR, "candidates.json");
const RESEARCHED_PATH = path.join(DATA_DIR, "researched-videos.json");
const REVIEW_PATH = path.join(DATA_DIR, "video-research-review.md");

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function callOllama(model, host, candidatesPayload, rankCount) {
  const endpoint = `${host.replace(/\/$/, "")}/api/generate`;
  const prompt = [
    "You are a YouTube research strategist for a short-form clipping engine.",
    "Rank the candidate videos by how likely they are to contain strong short-form clips.",
    `Return the best ${rankCount} candidates.`,
    "Favor videos that likely contain clear payoff moments, tutorials, glitches, reactions, controversy, mistakes, rankings, before/after moments, or dense information.",
    "Avoid slow vlogs, livestreams, playlist pages, music-only videos, and vague titles.",
    "Return ONLY strict JSON in this format:",
    '{"recommended":[{"rank":1,"url":"https://www.youtube.com/watch?v=...","title":"...","channel":"...","reason":"...","clipPotentialScore":8.7}]}',
    "Rules:",
    "- Use only candidate URLs from the provided payload",
    "- clipPotentialScore must be a number from 0 to 10",
    "- reason must be concise and useful for review",
    "- no markdown",
    "- no additional top-level keys except recommended",
    "",
    "Candidate payload:",
    JSON.stringify(candidatesPayload),
  ].join("\n");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.15 },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama error ${response.status}: ${text}`);
  }

  const body = await response.json();
  const raw = String(body.response || "").trim();
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("Could not parse JSON object from Ollama response.");
  }

  return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
}

function normalizeRecommendations(aiPayload, candidatesPayload, rankCount) {
  if (!aiPayload || !Array.isArray(aiPayload.recommended)) {
    throw new Error("Gemma response missing `recommended` array.");
  }

  const candidatesByUrl = new Map(
    candidatesPayload.candidates.map((candidate) => [candidate.url, candidate]),
  );

  const seen = new Set();
  const recommended = aiPayload.recommended
    .map((item, index) => {
      const url = String(item.url || "").trim();
      const source = candidatesByUrl.get(url);
      if (!source || seen.has(url)) return null;
      seen.add(url);

      return {
        rank: Number.isFinite(Number(item.rank)) ? Number(item.rank) : index + 1,
        url,
        title: String(item.title || source.title || "").trim(),
        channel: String(item.channel || source.channel || "").trim(),
        reason: String(item.reason || "").trim(),
        clipPotentialScore: Math.max(
          0,
          Math.min(10, Number(item.clipPotentialScore || 0)),
        ),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, rankCount)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  if (recommended.length === 0) {
    throw new Error("No valid ranked videos returned from Gemma.");
  }

  return {
    query: candidatesPayload.query,
    rankedAt: new Date().toISOString(),
    recommended,
  };
}

async function writeReviewMarkdown(payload) {
  const lines = [
    "# Video Research Review",
    "",
    `Query: ${payload.query}`,
    "",
    "Review the ranked videos below. To generate clip timestamps for one, run:",
    "",
    "`node main.js --use-researched 1`",
    "",
    "After reviewing `data/clips-review.md`, continue with:",
    "",
    "`node main.js --use-researched 1 --approved`",
    "",
  ];

  payload.recommended.forEach((video) => {
    lines.push(`## ${video.rank}. ${video.title || video.url}`);
    lines.push(`- URL: ${video.url}`);
    if (video.channel) lines.push(`- Channel: ${video.channel}`);
    lines.push(`- Clip potential: ${video.clipPotentialScore}/10`);
    lines.push(`- Reason: ${video.reason || "No reason provided."}`);
    lines.push("");
  });

  await fs.writeFile(REVIEW_PATH, lines.join("\n"), "utf8");
}

async function main() {
  const config = await readJson(CONFIG_PATH);
  const candidatesPayload = await readJson(CANDIDATES_PATH);
  const model = process.argv[2] || config.ollama?.model || "gemma3:4b";
  const host = config.ollama?.host || "http://127.0.0.1:11434";
  const rankCount = Number(process.argv[3] || config.research?.rankCount || 5);

  if (!Array.isArray(candidatesPayload.candidates) || candidatesPayload.candidates.length === 0) {
    throw new Error("No candidates found in data/candidates.json.");
  }

  const aiPayload = await callOllama(model, host, candidatesPayload, rankCount);
  const normalized = normalizeRecommendations(aiPayload, candidatesPayload, rankCount);

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(RESEARCHED_PATH, JSON.stringify(normalized, null, 2), "utf8");
  await writeReviewMarkdown(normalized);

  console.log(`Ranked videos saved: ${RESEARCHED_PATH}`);
  console.log(`Research review saved: ${REVIEW_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
