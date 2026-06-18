const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "Outputs");
const CLEAN_OUTPUT_DIR = path.join(OUTPUT_DIR, "clean");
const CLEAN_OG_DIR = path.join(OUTPUT_DIR, "clean-og");
const ASSETS_DIR = path.join(ROOT, "assets");
const PUBLIC_ASSETS_DIR = path.join(ROOT, "public", "assets");
const CONFIG_PATH = path.join(ROOT, "config.json");
const CLIPS_PATH = path.join(ROOT, "data", "clips.json");
const HYPERFRAMES_DIR = path.join(ROOT, "hyperframes-clip01");
const HYPERFRAMES_ASSETS_DIR = path.join(HYPERFRAMES_DIR, "assets");
const HYPERFRAMES_SOURCE_CLIP = path.join(HYPERFRAMES_ASSETS_DIR, "clip-01.mp4");

function clipBaseName(index) {
  return `clip-${String(index + 1).padStart(2, "0")}`;
}

function clipOriginalName(index) {
  return `${clipBaseName(index)}-og.mp4`;
}

function clipStyledName(index) {
  return `${clipBaseName(index)}-yt.mp4`;
}

function parseClipIndexFromFile(fileName) {
  const match = String(fileName).match(/^clip-(\d+)\.mp4$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value - 1 : null;
}

function quoteForCmd(value) {
  if (!value) return '""';
  if (!/[ \t"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function spawnCrossPlatform(command, args, cwd = ROOT) {
  if (process.platform === "win32") {
    const commandLine = [command, ...args].map(quoteForCmd).join(" ");
    return spawn("cmd.exe", ["/d", "/s", "/c", commandLine], {
      stdio: "inherit",
      cwd,
    });
  }

  return spawn(command, args, { stdio: "inherit", cwd });
}

function runCommand(command, args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const child = spawnCrossPlatform(command, args, cwd);
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `Required command not found: ${command}. Install dependencies and ensure the command is available.`,
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

async function syncAssetsToPublic(files) {
  await fs.mkdir(PUBLIC_ASSETS_DIR, { recursive: true });
  await Promise.all(
    files
      .filter((file) => file.toLowerCase().endsWith(".mp4"))
      .map((file) =>
        fs.copyFile(path.join(ASSETS_DIR, file), path.join(PUBLIC_ASSETS_DIR, file)),
      ),
  );
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function chunkWords(text, chunkSize) {
  const words = String(text || "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(" "));
  }
  return chunks;
}

function toShout(text, maxWords = 4) {
  return String(text || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ")
    .toUpperCase();
}

function hashString(value) {
  let hash = 2166136261;
  const input = String(value || "");
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const STYLE_VARIANTS = [
  {
    id: "neon-pop",
    rootBackground:
      "radial-gradient(circle at 15% 18%, #1c274f 0%, #090d1a 45%, #040507 100%)",
    videoFilter: "saturate(1.08) contrast(1.05)",
    captionTop: "66%",
    captionSize: 74,
    captionWidth: "94%",
    hotColor: "#8ee7ff",
    hotGlow: "rgba(142, 231, 255, 0.26)",
    memeToneA: "blue",
    memeToneB: "violet",
    memePosA: "right: 7%; top: 14%",
    memePosB: "left: 7%; top: 20%",
    stickerSet: ["✨", "😮"],
    boomText: "CLEAN CUT",
    accentA:
      "radial-gradient(circle at 30% 30%, rgba(120, 216, 255, 0.18), rgba(0,0,0,0) 62%)",
    accentB:
      "radial-gradient(circle at 70% 70%, rgba(160, 131, 255, 0.16), rgba(0,0,0,0) 60%)",
    captionInY: 30,
    captionScale: 0.92,
    captionInDuration: 0.34,
    captionOutY: -10,
    memeFloatY: -8,
  },
  {
    id: "warm-editorial",
    rootBackground:
      "radial-gradient(circle at 24% 12%, #3a2a1a 0%, #15100b 50%, #090806 100%)",
    videoFilter: "saturate(0.98) contrast(1.07) brightness(1.02)",
    captionTop: "68%",
    captionSize: 70,
    captionWidth: "92%",
    hotColor: "#ffd273",
    hotGlow: "rgba(255, 210, 115, 0.24)",
    memeToneA: "amber",
    memeToneB: "green",
    memePosA: "left: 8%; top: 13%",
    memePosB: "right: 7%; top: 18%",
    stickerSet: ["🧾", "😬"],
    boomText: "ORIGINAL TAKE",
    accentA:
      "radial-gradient(circle at 18% 24%, rgba(255, 197, 118, 0.16), rgba(0,0,0,0) 60%)",
    accentB:
      "radial-gradient(circle at 78% 72%, rgba(134, 236, 180, 0.14), rgba(0,0,0,0) 62%)",
    captionInY: 26,
    captionScale: 0.94,
    captionInDuration: 0.31,
    captionOutY: -8,
    memeFloatY: -6,
  },
  {
    id: "clean-tech",
    rootBackground:
      "radial-gradient(circle at 50% 10%, #18232f 0%, #0d141d 48%, #06090d 100%)",
    videoFilter: "saturate(1.03) contrast(1.04)",
    captionTop: "64%",
    captionSize: 68,
    captionWidth: "90%",
    hotColor: "#9df89a",
    hotGlow: "rgba(157, 248, 154, 0.22)",
    memeToneA: "green",
    memeToneB: "blue",
    memePosA: "right: 7%; top: 15%",
    memePosB: "left: 8%; top: 16%",
    stickerSet: ["📌", "🧠"],
    boomText: "NEW ANGLE",
    accentA:
      "radial-gradient(circle at 20% 16%, rgba(126, 214, 255, 0.14), rgba(0,0,0,0) 60%)",
    accentB:
      "radial-gradient(circle at 80% 80%, rgba(132, 255, 171, 0.12), rgba(0,0,0,0) 58%)",
    captionInY: 24,
    captionScale: 0.95,
    captionInDuration: 0.3,
    captionOutY: -7,
    memeFloatY: -7,
  },
  {
    id: "comedic-pop",
    rootBackground:
      "radial-gradient(circle at 22% 18%, #2a1533 0%, #150d20 46%, #08060d 100%)",
    videoFilter: "saturate(1.1) contrast(1.03)",
    captionTop: "67%",
    captionSize: 76,
    captionWidth: "95%",
    hotColor: "#ff93dc",
    hotGlow: "rgba(255, 147, 220, 0.22)",
    memeToneA: "violet",
    memeToneB: "amber",
    memePosA: "left: 8%; top: 15%",
    memePosB: "right: 7%; top: 21%",
    stickerSet: ["🤣", "👀"],
    boomText: "REWORKED",
    accentA:
      "radial-gradient(circle at 24% 14%, rgba(255, 155, 218, 0.16), rgba(0,0,0,0) 62%)",
    accentB:
      "radial-gradient(circle at 75% 78%, rgba(255, 202, 135, 0.14), rgba(0,0,0,0) 60%)",
    captionInY: 32,
    captionScale: 0.91,
    captionInDuration: 0.36,
    captionOutY: -11,
    memeFloatY: -9,
  },
];

function pickStyleVariant(clip, index) {
  const key = `${clip?.title || ""}|${clip?.hook || ""}|${index}`;
  const styleIndex = hashString(key) % STYLE_VARIANTS.length;
  return STYLE_VARIANTS[styleIndex];
}

function buildCaptionEntries(sourceText, durationSeconds) {
  const chunks = chunkWords(sourceText, 3).slice(0, 12);
  const entries = chunks.length > 0 ? chunks : ["HIGHLIGHT MOMENT"];
  const total = Math.max(4, Number(durationSeconds || 10));
  const activeStart = 0.35;
  const activeEnd = Math.max(activeStart + 1.2, total - 0.4);
  const slot = (activeEnd - activeStart) / entries.length;
  const captionDuration = Math.max(0.75, slot - 0.08);
  return entries.map((text, index) => ({
    id: `c${index + 1}`,
    text: text.toUpperCase(),
    start: Number((activeStart + index * slot).toFixed(2)),
    duration: Number(captionDuration.toFixed(2)),
    hot: index % 2 === 0,
  }));
}

function buildMemeEntries(clip, durationSeconds, variant) {
  const total = Math.max(4, Number(durationSeconds || 10));
  const title = toShout(clip?.title || "VIRAL MOMENT", 4) || "VIRAL MOMENT";
  const hookTailWords = String(clip?.hook || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(-3)
    .join(" ");
  const hookTail = toShout(hookTailWords, 3) || "NO WAY";
  return [
    {
      id: "m1",
      text: title,
      start: Number((Math.max(0.6, total * 0.25)).toFixed(2)),
      duration: 2.5,
      style: variant.memePosA,
      className: `meme ${variant.memeToneA}`,
    },
    {
      id: "m2",
      text: hookTail,
      start: Number((Math.max(2.6, total * 0.62)).toFixed(2)),
      duration: 2.4,
      style: variant.memePosB,
      className: `meme ${variant.memeToneB}`,
    },
  ];
}

function buildStickerEntries(durationSeconds, variant) {
  const total = Math.max(4, Number(durationSeconds || 10));
  return [
    {
      id: "s1",
      emoji: variant.stickerSet[0],
      start: Number((Math.max(1.4, total * 0.4)).toFixed(2)),
      duration: 1.5,
      style: "left: 82%; top: 56%",
    },
    {
      id: "s2",
      emoji: variant.stickerSet[1],
      start: Number((Math.max(3.4, total * 0.82)).toFixed(2)),
      duration: 1.5,
      style: "left: 10%; top: 54%",
    },
  ];
}

function buildHyperframesIndexHtml(clip, durationSeconds, index) {
  const variant = pickStyleVariant(clip, index);
  const captions = buildCaptionEntries(clip?.hook || clip?.title || "", durationSeconds);
  const memes = buildMemeEntries(clip, durationSeconds, variant);
  const stickers = buildStickerEntries(durationSeconds, variant);
  const duration = Number(durationSeconds.toFixed(2));

  const captionHtml = captions
    .map(
      (caption) => `
      <div id="${caption.id}" class="clip caption${caption.hot ? " hot" : ""}" data-start="${caption.start}" data-duration="${caption.duration}" data-track-index="10" style="top: var(--caption-top)">
        ${escapeHtml(caption.text)}
      </div>`,
    )
    .join("");

  const memeHtml = memes
    .map(
      (meme) => `
      <div id="${meme.id}" class="clip ${meme.className}" data-start="${meme.start}" data-duration="${meme.duration}" data-track-index="12" style="${meme.style}">
        ${escapeHtml(meme.text)}
      </div>`,
    )
    .join("");

  const stickerHtml = stickers
    .map(
      (sticker) => `
      <div id="${sticker.id}" class="clip sticker" data-start="${sticker.start}" data-duration="${sticker.duration}" data-track-index="13" style="${sticker.style}">
        ${escapeHtml(sticker.emoji)}
      </div>`,
    )
    .join("");

  const captionIds = captions.map((caption) => `"#${caption.id}"`).join(", ");
  const memeIds = memes.map((meme) => `"#${meme.id}"`).join(", ");
  const stickerIds = stickers.map((sticker) => `"#${sticker.id}"`).join(", ");
  const boomStart = Math.max(0.5, duration - 1.0);
  const boomEnd = Math.max(0.5, duration - 0.42);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      :root {
        --w: 1080px;
        --h: 1920px;
        --caption-size: ${variant.captionSize}px;
        --caption-top: ${variant.captionTop};
        --caption-width: ${variant.captionWidth};
        --hot-color: ${variant.hotColor};
        --hot-glow: ${variant.hotGlow};
      }
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html,
      body {
        width: var(--w);
        height: var(--h);
        overflow: hidden;
        background: #000;
        font-family:
          "Anton", "Impact", "Arial Black", "Segoe UI", "Inter", sans-serif;
      }
      #root {
        position: relative;
        width: var(--w);
        height: var(--h);
        overflow: hidden;
        background: ${variant.rootBackground};
      }
      .layer {
        position: absolute;
        inset: 0;
      }
      .accent {
        position: absolute;
        inset: 0;
        pointer-events: none;
        mix-blend-mode: screen;
        opacity: 0.7;
      }
      .accent.a {
        background: ${variant.accentA};
      }
      .accent.b {
        background: ${variant.accentB};
      }
      .clip-video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        filter: ${variant.videoFilter};
      }
      .vignette {
        background: linear-gradient(
          to bottom,
          rgba(0, 0, 0, 0.18),
          rgba(0, 0, 0, 0.08) 22%,
          rgba(0, 0, 0, 0.32)
        );
      }
      .caption {
        position: absolute;
        left: 50%;
        width: var(--caption-width);
        transform: translateX(-50%);
        text-align: center;
        line-height: 1.06;
        font-size: var(--caption-size);
        font-weight: 900;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: #fff;
        text-shadow:
          -4px -4px 0 #000,
          4px -4px 0 #000,
          -4px 4px 0 #000,
          4px 4px 0 #000,
          0 0 12px rgba(255, 255, 255, 0.2);
      }
      .caption.hot {
        color: var(--hot-color);
        text-shadow:
          -4px -4px 0 #1a1a1a,
          4px -4px 0 #1a1a1a,
          -4px 4px 0 #1a1a1a,
          4px 4px 0 #1a1a1a,
          0 0 10px var(--hot-glow);
      }
      .meme {
        position: absolute;
        min-width: 180px;
        max-width: 420px;
        border-radius: 18px;
        padding: 12px 18px;
        border: 3px solid #fff;
        color: #fff;
        background: rgba(0, 0, 0, 0.52);
        font-size: 36px;
        font-weight: 800;
        text-transform: uppercase;
        text-align: center;
        line-height: 1;
        text-shadow: 0 2px 0 #000;
        box-shadow:
          0 0 0 3px rgba(0, 0, 0, 0.22),
          0 10px 20px rgba(0, 0, 0, 0.25);
      }
      .meme.blue {
        border-color: #71f2ff;
        background: rgba(5, 31, 77, 0.72);
      }
      .meme.green {
        border-color: #67ffae;
        background: rgba(7, 49, 26, 0.72);
      }
      .meme.violet {
        border-color: #d3a2ff;
        background: rgba(44, 18, 74, 0.72);
      }
      .meme.amber {
        border-color: #ffc17a;
        background: rgba(59, 34, 6, 0.72);
      }
      .sticker {
        position: absolute;
        font-size: 88px;
        filter: drop-shadow(0 8px 10px rgba(0, 0, 0, 0.4));
      }
      .boom {
        position: absolute;
        top: 52%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 180px;
        font-weight: 900;
        color: #fff;
        text-shadow: 0 0 10px rgba(0, 0, 0, 0.4);
        opacity: 0;
        pointer-events: none;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="clip-subtle"
      data-start="0"
      data-duration="${duration}"
      data-width="1080"
      data-height="1920"
    >
      <video
        id="video-base"
        class="clip layer clip-video"
        data-start="0"
        data-duration="${duration}"
        data-track-index="0"
        src="assets/clip-01.mp4"
        playsinline
        muted
      ></video>
      <audio
        id="audio-base"
        class="clip"
        data-start="0"
        data-duration="${duration}"
        data-track-index="1"
        src="assets/clip-01.mp4"
      ></audio>

      <div id="vignette" class="clip layer vignette" data-start="0" data-duration="${duration}" data-track-index="2"></div>
      <div id="accent-a" class="clip accent a" data-start="0" data-duration="${duration}" data-track-index="3"></div>
      <div id="accent-b" class="clip accent b" data-start="0" data-duration="${duration}" data-track-index="4"></div>
      ${captionHtml}
      ${memeHtml}
      ${stickerHtml}
      <div id="boom" class="clip boom" data-start="${boomStart.toFixed(2)}" data-duration="0.92" data-track-index="20">${escapeHtml(variant.boomText)}</div>
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      const totalDuration = Number(document.querySelector("#root").dataset.duration || ${duration});
      const accentARepeats = Math.max(0, Math.floor(totalDuration / 6.2) - 1);
      const accentBRepeats = Math.max(0, Math.floor(totalDuration / 7.2) - 1);

      [${captionIds}].forEach((id) => {
        const el = document.querySelector(id);
        const start = Number(el.dataset.start);
        const duration = Number(el.dataset.duration);
        tl.fromTo(
          id,
          { y: ${variant.captionInY}, scale: ${variant.captionScale}, opacity: 0 },
          { y: 0, scale: 1, opacity: 1, duration: ${variant.captionInDuration}, ease: "power2.out" },
          start,
        );
        tl.to(id, { opacity: 0, y: ${variant.captionOutY}, duration: 0.24, ease: "power1.in" }, start + duration - 0.24);
      });

      [${memeIds}].forEach((id) => {
        const el = document.querySelector(id);
        const start = Number(el.dataset.start);
        const duration = Number(el.dataset.duration);
        tl.fromTo(
          id,
          { scale: 0.8, y: 12, opacity: 0 },
          { scale: 1, y: 0, opacity: 1, duration: 0.32, ease: "power2.out" },
          start,
        );
        tl.to(id, { y: ${variant.memeFloatY}, duration: 0.9, repeat: 1, yoyo: true, ease: "sine.inOut" }, start + 0.25);
        tl.to(id, { opacity: 0, duration: 0.22, ease: "power1.in" }, start + duration - 0.22);
      });

      [${stickerIds}].forEach((id) => {
        const el = document.querySelector(id);
        const start = Number(el.dataset.start);
        const duration = Number(el.dataset.duration);
        tl.fromTo(
          id,
          { scale: 0.7, opacity: 0, rotation: -8 },
          { scale: 1, opacity: 1, rotation: 0, duration: 0.24, ease: "power2.out" },
          start,
        );
        tl.to(id, { y: -18, scale: 1.04, duration: 0.8, ease: "power1.out" }, start + 0.2);
        tl.to(id, { opacity: 0, scale: 0.88, duration: 0.2, ease: "power2.in" }, start + duration - 0.2);
      });

      tl.fromTo("#boom", { scale: 0.9, y: 16, opacity: 0 }, { scale: 1, y: 0, opacity: 1, duration: 0.25, ease: "power2.out" }, ${boomStart.toFixed(2)});
      tl.to("#boom", { opacity: 0, duration: 0.3, ease: "power2.in" }, ${boomEnd.toFixed(2)});
      tl.fromTo("#accent-a", { x: -46, y: 0, opacity: 0.3 }, { x: 38, y: -26, opacity: 0.65, duration: 6.2, repeat: accentARepeats, yoyo: true, ease: "sine.inOut" }, 0);
      tl.fromTo("#accent-b", { x: 52, y: 18, opacity: 0.24 }, { x: -34, y: -18, opacity: 0.52, duration: 7.2, repeat: accentBRepeats, yoyo: true, ease: "sine.inOut" }, 0);

      window.__timelines["clip-subtle"] = tl;
    </script>
  </body>
</html>
`;
}

function getDurationSeconds(clip, fileName) {
  const delta = Number(clip?.end) - Number(clip?.start);
  if (Number.isFinite(delta) && delta > 0) {
    return Math.max(2, delta);
  }

  const fallback = Number(fileName.match(/\d+/)?.[0] || 1);
  return 25 + fallback * 5;
}

async function renderWithRemotion(config, clipsPayload) {
  const entry = config.remotion?.entry || "remotion/index.ts";
  const remotionBin =
    process.platform === "win32"
      ? path.join(ROOT, "node_modules", ".bin", "remotion.cmd")
      : path.join(ROOT, "node_modules", ".bin", "remotion");

  try {
    await fs.access(remotionBin);
  } catch {
    throw new Error(
      "Remotion CLI not found. Run `npm install` in the project root before rendering.",
    );
  }

  for (let i = 0; i < clipsPayload.clips.length; i += 1) {
    const compositionBaseId = `YTClip-${String(i + 1).padStart(2, "0")}`;
    const ogCompositionId = `${compositionBaseId}-OG`;
    const ytCompositionId = `${compositionBaseId}-YT`;
    const originalOutput = path.join(OUTPUT_DIR, clipOriginalName(i));
    const cleanOgOutput = path.join(CLEAN_OG_DIR, clipOriginalName(i));
    const styledName = clipStyledName(i);
    const output = path.join(OUTPUT_DIR, styledName);
    const cleanOutput = path.join(CLEAN_OUTPUT_DIR, styledName);
    console.log(`Rendering ${ogCompositionId} -> ${originalOutput}`);
    await runCommand(remotionBin, [
      "render",
      entry,
      ogCompositionId,
      originalOutput,
      "--concurrency",
      "2",
    ]);
    await fs.copyFile(originalOutput, cleanOgOutput);
    console.log(`Rendering ${ytCompositionId} -> ${output}`);
    await runCommand(remotionBin, [
      "render",
      entry,
      ytCompositionId,
      output,
      "--concurrency",
      "2",
    ]);
    await fs.copyFile(output, cleanOutput);
  }
}

async function renderWithHyperframes(clipsPayload, files) {
  await fs.mkdir(HYPERFRAMES_ASSETS_DIR, { recursive: true });

  const clipFiles = files
    .filter((file) => /^clip-\d+\.mp4$/i.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (clipFiles.length === 0) {
    throw new Error("No extracted clip files found in assets/.");
  }

  for (let i = 0; i < clipFiles.length; i += 1) {
    const fileName = clipFiles[i];
    const sourcePath = path.join(ASSETS_DIR, fileName);
    const parsedIndex = parseClipIndexFromFile(fileName);
    const clipIndex = parsedIndex ?? i;
    const outputPath = path.join(OUTPUT_DIR, clipStyledName(clipIndex));
    const cleanOutput = path.join(CLEAN_OUTPUT_DIR, clipStyledName(clipIndex));
    const originalOutput = path.join(OUTPUT_DIR, clipOriginalName(clipIndex));
    const cleanOgOutput = path.join(CLEAN_OG_DIR, clipOriginalName(clipIndex));
    const clipData = clipsPayload.clips[clipIndex] || {};
    const durationSeconds = getDurationSeconds(clipData, fileName);
    const indexHtml = buildHyperframesIndexHtml(clipData, durationSeconds, clipIndex);

    await fs.copyFile(sourcePath, HYPERFRAMES_SOURCE_CLIP);
    await fs.copyFile(sourcePath, originalOutput).catch(() => null);
    await fs.copyFile(sourcePath, cleanOgOutput).catch(() => null);
    await fs.writeFile(path.join(HYPERFRAMES_DIR, "index.html"), indexHtml, "utf8");

    console.log(`Rendering ${fileName} with HyperFrames subtle template...`);
    await runCommand(
      "npx",
      [
        "--yes",
        "hyperframes@0.6.6",
        "render",
        "--output",
        outputPath,
      ],
      HYPERFRAMES_DIR,
    );

    await fs.copyFile(outputPath, cleanOutput);
  }
}

async function main() {
  const config = await readJson(CONFIG_PATH);
  const clipsPayload = await readJson(CLIPS_PATH);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(CLEAN_OUTPUT_DIR, { recursive: true });
  await fs.mkdir(CLEAN_OG_DIR, { recursive: true });

  const files = await fs.readdir(ASSETS_DIR).catch(() => []);
  if (!files.some((f) => f.endsWith(".mp4"))) {
    throw new Error("No clips found in assets/. Run extraction first.");
  }
  await syncAssetsToPublic(files);

  if (!Array.isArray(clipsPayload.clips) || clipsPayload.clips.length === 0) {
    throw new Error("No clips found in data/clips.json.");
  }

  const renderer = (config.renderer || "hyperframes").toLowerCase();
  if (renderer === "remotion") {
    await renderWithRemotion(config, clipsPayload);
    return;
  }

  await renderWithHyperframes(clipsPayload, files);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
