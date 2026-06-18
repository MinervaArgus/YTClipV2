const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
require("dotenv").config();

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const CONFIG_PATH = path.join(ROOT, "config.json");
const CANDIDATES_PATH = path.join(DATA_DIR, "candidates.json");

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function postJson(baseUrl, endpoint, payload) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Surfagent ${endpoint} failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function evalOnPage(baseUrl, expression) {
  const payload = await postJson(baseUrl, "/eval", {
    tab: "0",
    expression,
  });
  return payload.result;
}

function runCommandCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractVideoId(value) {
  const text = decodeHtml(value);
  const watchMatch = text.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];

  const shortMatch = text.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];

  return null;
}

function normalizeUrl(value) {
  const text = decodeHtml(value);
  const videoId = extractVideoId(text);
  if (!videoId) return null;
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function getUsefulText(value) {
  const text = decodeHtml(value)
    .replace(/\s+/g, " ")
    .replace(/^\W+|\W+$/g, "")
    .trim();

  if (!text || text.length < 4) return "";
  if (/^(http|\/watch|#|button|link|thumbnail)$/i.test(text)) return "";
  if (isBadTitle(text)) return "";
  return text;
}

function isBadTitle(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (/^\d{1,2}:\d{2}(?::\d{2})?\s*(now playing)?$/i.test(text)) return true;
  if (/\bnow playing\b/i.test(text) && /^\d/.test(text)) return true;
  if (/^\d+(?:\.\d+)?[KMB]?\s+views?\b/i.test(text)) return true;
  if (/^\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b/i.test(text)) return true;
  if (/^(watch|play all|mix|playlist|shorts|live|subscribed|subscribe)$/i.test(text)) return true;
  return false;
}

async function fetchOembedMetadata(url) {
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const response = await fetch(endpoint);
  if (!response.ok) return null;

  const payload = await response.json();
  return {
    title: getUsefulText(payload.title || ""),
    channel: getUsefulText(payload.author_name || ""),
  };
}

function collectCandidatesFromObject(value, candidates = []) {
  if (!value || typeof value !== "object") return candidates;

  if (Array.isArray(value)) {
    value.forEach((item) => collectCandidatesFromObject(item, candidates));
    return candidates;
  }

  const strings = Object.entries(value)
    .filter(([, item]) => typeof item === "string")
    .map(([key, item]) => ({ key, value: item }));

  const urlLike = strings.find(({ value: item }) => normalizeUrl(item));
  if (urlLike) {
    const url = normalizeUrl(urlLike.value);
    const textFields = strings
      .filter(({ key }) => /title|text|label|aria|name|channel|metadata|description/i.test(key))
      .map(({ value: item }) => getUsefulText(item))
      .filter(Boolean);

    const title =
      textFields.find((text) => !/views|ago|subscribers|verified|watch|now playing/i.test(text)) ||
      "";
    const channel =
      textFields.find((text) => /channel|verified/i.test(text)) ||
      "";

    candidates.push({
      url,
      videoId: extractVideoId(url),
      title,
      channel,
      metadata: textFields.slice(0, 6),
    });
  }

  Object.values(value).forEach((item) => collectCandidatesFromObject(item, candidates));
  return candidates;
}

function collectCandidatesFromRawPayload(payload) {
  const raw = decodeHtml(JSON.stringify(payload));
  const matches = raw.match(/(?:https?:\/\/(?:www\.)?youtube\.com)?\/watch\?v=[a-zA-Z0-9_-]{11}[^"'<>\s]*/g) || [];

  return matches
    .map((match) => normalizeUrl(match))
    .filter(Boolean)
    .map((url) => ({
      url,
      videoId: extractVideoId(url),
      title: "",
      channel: "",
      metadata: [],
    }));
}

async function collectCandidatesFromYtDlp(query, limit) {
  const args = [
    `ytsearch${limit}:${query}`,
    "--dump-json",
    "--skip-download",
    "--flat-playlist",
  ];

  let output = "";
  try {
    output = await runCommandCapture("yt-dlp", args);
  } catch {
    output = await runCommandCapture("python", ["-m", "yt_dlp", ...args]);
  }

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map((item) => ({
      url: normalizeUrl(item.webpage_url || item.original_url || item.url || item.id),
      videoId: item.id || extractVideoId(item.url || item.webpage_url || ""),
      title: getUsefulText(item.title || ""),
      channel: getUsefulText(item.channel || item.uploader || ""),
      metadata: [
        item.title,
        item.channel || item.uploader,
        item.duration_string,
        item.view_count ? `${item.view_count} views` : "",
        item.description,
      ]
        .map(getUsefulText)
        .filter(Boolean),
    }))
    .filter((candidate) => candidate.url && candidate.videoId);
}

async function collectCandidatesFromDom(baseUrl) {
  const expression = `(() => {
    const selectors = [
      'ytd-video-renderer',
      'ytd-rich-item-renderer',
      'ytd-grid-video-renderer',
      'a#video-title',
      'a#video-title-link'
    ];
    const cards = Array.from(document.querySelectorAll(selectors.join(',')));
    const seen = new Set();
    const out = [];

    for (const card of cards) {
      const root = card.matches('a') ? card.closest('ytd-video-renderer,ytd-rich-item-renderer,ytd-grid-video-renderer') || card : card;
      const titleEl = root.querySelector('a#video-title, a#video-title-link, h3 a, a[title]') || (root.matches('a') ? root : null);
      if (!titleEl) continue;

      const href = titleEl.href || titleEl.getAttribute('href') || '';
      const match = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (!match || seen.has(match[1])) continue;
      seen.add(match[1]);

      const channelEl = root.querySelector('ytd-channel-name a, #channel-name a, a[href^="/@"]');
      const metaTexts = Array.from(root.querySelectorAll('#metadata-line span, .metadata-line span, yt-formatted-string, span'))
        .map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 8);

      out.push({
        url: 'https://www.youtube.com/watch?v=' + match[1],
        videoId: match[1],
        title: (titleEl.getAttribute('title') || titleEl.textContent || '').replace(/\\s+/g, ' ').trim(),
        channel: channelEl ? (channelEl.textContent || '').replace(/\\s+/g, ' ').trim() : '',
        metadata: metaTexts
      });
    }

    return out;
  })()`;

  const result = await evalOnPage(baseUrl, expression);
  return Array.isArray(result) ? result : [];
}

function dedupeAndFilter(candidates, options) {
  const seen = new Set();
  const filtered = [];

  for (const candidate of candidates) {
    if (!candidate.videoId || seen.has(candidate.videoId)) continue;
    seen.add(candidate.videoId);

    const combinedText = [
      candidate.url,
      candidate.title,
      candidate.channel,
      ...(candidate.metadata || []),
    ]
      .join(" ")
      .toLowerCase();

    if (options.excludeShorts && combinedText.includes("/shorts/")) continue;
    if (options.excludeLive && /\blive\b|premiere|streaming now/.test(combinedText)) continue;

    filtered.push({
      url: candidate.url,
      videoId: candidate.videoId,
      title: isBadTitle(candidate.title) ? "" : candidate.title,
      channel: candidate.channel || "",
      metadata: candidate.metadata || [],
    });
  }

  return filtered;
}

async function enrichCandidates(candidates) {
  const enriched = [];

  for (const candidate of candidates) {
    let metadata = null;
    if (!candidate.title || isBadTitle(candidate.title) || !candidate.channel) {
      metadata = await fetchOembedMetadata(candidate.url).catch(() => null);
    }

    enriched.push({
      ...candidate,
      title:
        metadata?.title ||
        (isBadTitle(candidate.title) ? "" : candidate.title) ||
        `YouTube video ${candidate.videoId}`,
      channel: metadata?.channel || candidate.channel || "",
    });
  }

  return enriched;
}

async function main() {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) {
    throw new Error("Usage: node scripts/research-videos.js <youtube_search_query>");
  }

  const config = await readJson(CONFIG_PATH);
  const surfagentHost = process.env.SURFAGENT_HOST || config.surfagent?.host || "http://localhost:3456";
  const resultLimit = Number(config.surfagent?.searchResultLimit || 10);
  const researchConfig = config.research || {};
  const scrollPasses = Number(config.surfagent?.scrollPasses || 6);
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${encodeURIComponent("EgIQAQ==")}`;

  await fs.mkdir(DATA_DIR, { recursive: true });

  console.log(`Researching YouTube query: ${query}`);
  console.log(`Using Surfagent: ${surfagentHost}`);

  await postJson(surfagentHost, "/navigate", { tab: "0", url: searchUrl });
  await postJson(surfagentHost, "/dismiss", { tab: "0" }).catch(() => null);

  const domCandidates = [];
  for (let pass = 0; pass < scrollPasses; pass += 1) {
    domCandidates.push(...(await collectCandidatesFromDom(surfagentHost).catch(() => [])));

    const currentCandidates = dedupeAndFilter(domCandidates, {
      excludeShorts: researchConfig.excludeShorts !== false,
      excludeLive: researchConfig.excludeLive !== false,
    });
    if (currentCandidates.length >= resultLimit) break;

    await postJson(surfagentHost, "/scroll", {
      tab: "0",
      direction: "down",
      amount: 1800,
    }).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 850));
  }

  const [readPayload, reconPayload] = await Promise.all([
    postJson(surfagentHost, "/read", { tab: "0" }),
    postJson(surfagentHost, "/recon", { tab: "0" }),
  ]);

  const objectCandidates = [
    ...domCandidates,
    ...collectCandidatesFromObject(readPayload),
    ...collectCandidatesFromObject(reconPayload),
  ];
  const rawCandidates = [
    ...collectCandidatesFromRawPayload(readPayload),
    ...collectCandidatesFromRawPayload(reconPayload),
  ];

  let candidates = dedupeAndFilter([...objectCandidates, ...rawCandidates], {
    excludeShorts: researchConfig.excludeShorts !== false,
    excludeLive: researchConfig.excludeLive !== false,
  });

  if (candidates.length < resultLimit) {
    const ytDlpCandidates = await collectCandidatesFromYtDlp(query, resultLimit).catch(() => []);
    candidates = dedupeAndFilter([...candidates, ...ytDlpCandidates], {
      excludeShorts: researchConfig.excludeShorts !== false,
      excludeLive: researchConfig.excludeLive !== false,
    });
  }

  candidates = await enrichCandidates(candidates.slice(0, resultLimit));

  if (candidates.length === 0) {
    throw new Error("No YouTube video candidates found. Check that Surfagent can read the YouTube results page.");
  }

  const output = {
    query,
    searchedAt: new Date().toISOString(),
    source: "surfagent",
    searchUrl,
    candidates,
  };

  await fs.writeFile(CANDIDATES_PATH, JSON.stringify(output, null, 2), "utf8");
  console.log(`Candidate videos saved: ${CANDIDATES_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
