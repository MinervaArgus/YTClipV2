const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
require("dotenv").config();

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "Outputs");
const CLEAN_OUTPUT_DIR = path.join(OUTPUT_DIR, "clean");
const CONFIG_PATH = path.join(ROOT, "config.json");
const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_PATH,
  "ffmpeg",
  "ffmpeg.exe",
  path.join(ROOT, "ffmpeg", "bin", "ffmpeg.exe"),
  "C:\\ffmpeg\\bin\\ffmpeg.exe",
  "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
  "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
].filter(Boolean);

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

function isFileBusyError(error) {
  const code = String(error?.code || "");
  if (code === "EPERM" || code === "EBUSY" || code === "EACCES") return true;
  const message = String(error?.message || "");
  return /EPERM|EBUSY|EACCES|operation not permitted/i.test(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function replaceFileWithRetries(sourcePath, destinationPath) {
  let lastError = null;

  // Try multiple times in case Windows still has a transient lock.
  for (let attempt = 0; attempt < 16; attempt += 1) {
    try {
      await fs.rm(destinationPath, { force: true }).catch(() => null);
      await fs.rename(sourcePath, destinationPath);
      return;
    } catch (error) {
      lastError = error;
      if (!isFileBusyError(error)) {
        throw error;
      }
      await wait(120 + attempt * 80);
    }
  }

  // Fallback: copy in place and then remove temp, useful when rename keeps failing.
  try {
    await fs.copyFile(sourcePath, destinationPath);
    await fs.rm(sourcePath, { force: true }).catch(() => null);
    return;
  } catch (error) {
    lastError = error;
  }

  throw new Error(
    `Could not replace ${path.basename(destinationPath)} because the file appears to be locked by another app. Close video players/editors using this clip and retry. Last error: ${String(lastError?.message || lastError)}`,
  );
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed) {
  let state = seed || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBetweenWith(rng, min, max) {
  return min + rng() * (max - min);
}

function pick(items, rng = Math.random) {
  return items[Math.floor(rng() * items.length)];
}

function normalizeMusicConfig(config) {
  const music = config.music || {};
  const minVolume = clamp(Number(music.minVolume ?? 0.22), 0, 1);
  const maxVolume = clamp(Number(music.maxVolume ?? 0.34), minVolume, 1);

  return {
    minVolume,
    maxVolume,
    sourceAudioWeight: clamp(Number(music.sourceAudioWeight ?? 1), 0.1, 3),
    fadeInSeconds: clamp(Number(music.fadeInSeconds ?? 0.7), 0, 10),
    lowpassHz: Math.round(clamp(Number(music.lowpassHz ?? 3500), 500, 12000)),
    highpassHz: Math.round(clamp(Number(music.highpassHz ?? 70), 20, 500)),
  };
}

function midiToFrequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function softClip(value) {
  return Math.tanh(value);
}

const GROOVE_PRESETS = [
  {
    name: "rubber-bass-funk",
    roots: [36, 38, 41, 43],
    scale: [0, 3, 5, 7, 10, 12, 15],
    bpm: [92, 104],
    swing: [0.075, 0.12],
    bassPatterns: [
      [0, 0, 7, 0, 10, null, 7, 5, 0, 12, 10, 7, 5, null, 3, 0],
      [0, null, 0, 3, 5, 7, null, 5, 10, 7, 5, 3, 0, 12, null, 7],
    ],
    chordEvery: 4,
    leadEvery: 3,
    hatEvery: 1,
    snareSteps: [4, 12],
    kickSteps: [0, 7, 8, 14],
    tone: "pluck",
  },
  {
    name: "arcade-pop-funk",
    roots: [40, 43, 45, 47],
    scale: [0, 2, 4, 7, 9, 12, 14, 16],
    bpm: [108, 124],
    swing: [0.025, 0.055],
    bassPatterns: [
      [0, 7, 12, 7, 4, 7, 12, 7, 9, 7, 4, 2, 0, 4, 7, 12],
      [0, 0, 12, null, 9, 7, 4, null, 5, 7, 9, 12, 7, 4, 2, 0],
    ],
    chordEvery: 8,
    leadEvery: 2,
    hatEvery: 1,
    snareSteps: [4, 12],
    kickSteps: [0, 6, 8, 10],
    tone: "square",
  },
  {
    name: "disco-clav-bounce",
    roots: [38, 40, 45],
    scale: [0, 3, 5, 6, 7, 10, 12, 15],
    bpm: [116, 128],
    swing: [0.035, 0.07],
    bassPatterns: [
      [0, 12, 10, 7, 5, 7, 10, 12, 0, 12, 10, 7, 3, 5, 7, 10],
      [0, 7, null, 10, 12, 10, 7, 5, 3, 5, 7, null, 10, 12, 7, 0],
    ],
    chordEvery: 2,
    leadEvery: 4,
    hatEvery: 1,
    snareSteps: [4, 12],
    kickSteps: [0, 4, 8, 12],
    tone: "clav",
  },
  {
    name: "lazy-wah-groove",
    roots: [35, 38, 42],
    scale: [0, 3, 5, 7, 10, 12, 17],
    bpm: [82, 96],
    swing: [0.105, 0.16],
    bassPatterns: [
      [0, null, 0, 7, null, 10, 7, null, 5, null, 3, 5, 7, null, 10, 7],
      [0, 0, null, 3, 5, null, 7, 10, 7, null, 5, 3, 0, null, -2, 0],
    ],
    chordEvery: 6,
    leadEvery: 5,
    hatEvery: 2,
    snareSteps: [6, 14],
    kickSteps: [0, 8, 11],
    tone: "wah",
  },
  {
    name: "breakbeat-funk",
    roots: [37, 39, 44],
    scale: [0, 2, 3, 5, 7, 10, 12, 14],
    bpm: [96, 112],
    swing: [0.045, 0.095],
    bassPatterns: [
      [0, 0, null, 7, 10, null, 7, 3, 0, 12, null, 10, 7, 5, null, 3],
      [0, null, 7, 0, 10, 12, null, 7, 5, null, 3, 0, 7, null, 10, 12],
    ],
    chordEvery: 5,
    leadEvery: 6,
    hatEvery: 1,
    snareSteps: [3, 8, 12],
    kickSteps: [0, 5, 10, 15],
    tone: "pluck",
  },
];

function writeWav(filePath, samples, sampleRate) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * bytesPerSample);
  }

  return fs.writeFile(filePath, buffer);
}

async function generateFunkyMusicBed(filePath, identity) {
  const sampleRate = 48000;
  const durationSeconds = 180;
  const totalSamples = sampleRate * durationSeconds;
  const samples = new Float32Array(totalSamples);
  const preset = GROOVE_PRESETS[identity.index % GROOVE_PRESETS.length];
  const rng = createRng(hashString(`${identity.fileName}-${identity.index}-${Date.now()}`));
  const root = pick(preset.roots, rng) + pick([0, 0, 12], rng);
  const scale = preset.scale;
  const bpm = Math.round(randomBetweenWith(rng, preset.bpm[0], preset.bpm[1]));
  const beatSeconds = 60 / bpm;
  const stepSeconds = beatSeconds / 2;
  const swing = randomBetweenWith(rng, preset.swing[0], preset.swing[1]);
  const bassPattern = pick(preset.bassPatterns, rng);
  const leadPattern = Array.from({ length: 32 }, (_, index) =>
    index % preset.leadEvery === 0 ? null : pick(scale, rng) + pick([12, 12, 24], rng),
  );
  const chordPattern = [
    [0, scale[1] || 3, scale[3] || 7],
    [scale[2] || 5, scale[4] || 10, 12],
    [scale[3] || 7, scale[5] || 12, 14],
    [scale[1] || 3, scale[3] || 7, scale[4] || 10],
  ];

  function addTone(startSeconds, lengthSeconds, frequency, volume, type = "sine") {
    const start = Math.max(0, Math.floor(startSeconds * sampleRate));
    const length = Math.max(1, Math.floor(lengthSeconds * sampleRate));
    const end = Math.min(samples.length, start + length);

    for (let i = start; i < end; i += 1) {
      const local = (i - start) / sampleRate;
      const progress = (i - start) / length;
      const attack = Math.min(1, progress / 0.08);
      const release = Math.min(1, (1 - progress) / 0.18);
      const envelope = Math.max(0, Math.min(attack, release)) ** 1.4;
      const phase = 2 * Math.PI * frequency * local;
      let wave = Math.sin(phase);

      if (type === "bass") {
        wave = Math.sin(phase) * 0.75 + Math.sin(phase * 2) * 0.18;
      } else if (type === "square") {
        wave = Math.sign(Math.sin(phase)) * 0.55 + Math.sin(phase * 2) * 0.12;
      } else if (type === "pluck") {
        wave = Math.sin(phase) * 0.65 + Math.sin(phase * 3) * 0.2;
      } else if (type === "clav") {
        wave = Math.sign(Math.sin(phase)) * 0.38 + Math.sin(phase * 5) * 0.16;
      } else if (type === "wah") {
        const wobble = 0.55 + Math.sin(local * Math.PI * 7) * 0.35;
        wave = (Math.sin(phase) * 0.6 + Math.sin(phase * 2) * 0.18) * wobble;
      }

      samples[i] += wave * envelope * volume;
    }
  }

  function addNoiseHit(startSeconds, lengthSeconds, volume, tone = "hat") {
    const start = Math.max(0, Math.floor(startSeconds * sampleRate));
    const length = Math.max(1, Math.floor(lengthSeconds * sampleRate));
    const end = Math.min(samples.length, start + length);

    for (let i = start; i < end; i += 1) {
      const progress = (i - start) / length;
      const envelope = (1 - progress) ** (tone === "snare" ? 3 : 8);
      const noise = rng() * 2 - 1;
      samples[i] += noise * envelope * volume;
    }
  }

  for (let step = 0; step * stepSeconds < durationSeconds; step += 1) {
    const swungOffset = step % 2 === 1 ? swing : 0;
    const time = step * stepSeconds + swungOffset;
    const bassNote = root + bassPattern[step % bassPattern.length];

    if (bassNote !== null) {
      addTone(time, stepSeconds * 0.92, midiToFrequency(bassNote), 0.18, "bass");
    }

    if (step % preset.chordEvery === 0 || step % 16 === 14) {
      const chord = chordPattern[Math.floor(step / 8) % chordPattern.length];
      chord.forEach((interval, idx) => {
        addTone(
          time + idx * randomBetweenWith(rng, 0.008, 0.018),
          beatSeconds * randomBetweenWith(rng, 0.22, 0.55),
          midiToFrequency(root + 24 + interval),
          preset.name === "disco-clav-bounce" ? 0.035 : 0.045,
          preset.tone,
        );
      });
    }

    const leadNote = leadPattern[step % leadPattern.length];
    if (leadNote !== null && step % preset.leadEvery !== 0) {
      addTone(
        time + randomBetweenWith(rng, 0, 0.03),
        stepSeconds * randomBetweenWith(rng, 0.2, 0.8),
        midiToFrequency(root + leadNote),
        randomBetweenWith(rng, 0.04, 0.07),
        pick(["sine", "square", "pluck", preset.tone], rng),
      );
    }

    if (step % preset.hatEvery === 0) {
      addNoiseHit(time, 0.03, step % 2 === 0 ? 0.038 : 0.024, "hat");
    }
    if (preset.kickSteps.includes(step % 16)) {
      addTone(time, 0.13, randomBetweenWith(rng, 48, 64), 0.24, "bass");
    }
    if (preset.snareSteps.includes(step % 16)) {
      addNoiseHit(time, 0.11, 0.08, "snare");
    }
  }

  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = softClip(samples[i] * 1.4) * 0.85;
  }

  await writeWav(filePath, samples, sampleRate);
  return { name: preset.name, bpm, root };
}

async function mixMusicIntoClip(sourceClipPath, outputClipPath, musicConfig, identity) {
  const tempOutput = outputClipPath.replace(/\.mp4$/i, ".music-tmp.mp4");
  const tempMusic = outputClipPath.replace(/\.mp4$/i, ".funk-bed.wav");
  const musicVolume = Number(
    randomBetween(musicConfig.minVolume, musicConfig.maxVolume).toFixed(3),
  );
  const generated = await generateFunkyMusicBed(tempMusic, identity);

  const filterComplex = [
    `[1:a]volume=${musicVolume},lowpass=f=${musicConfig.lowpassHz},highpass=f=${musicConfig.highpassHz},afade=t=in:st=0:d=${musicConfig.fadeInSeconds}[musicbed]`,
    `[0:a][musicbed]amix=inputs=2:duration=first:weights=${musicConfig.sourceAudioWeight} 1:normalize=0[aout]`,
  ].join(";");

  const withSourceAudioArgs = [
    "-y",
    "-i",
    sourceClipPath,
    "-i",
    tempMusic,
    "-filter_complex",
    filterComplex,
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

  const musicOnlyFallbackArgs = [
    "-y",
    "-i",
    sourceClipPath,
    "-i",
    tempMusic,
    "-filter_complex",
    `[1:a]volume=${musicVolume},lowpass=f=${musicConfig.lowpassHz},highpass=f=${musicConfig.highpassHz},afade=t=in:st=0:d=${musicConfig.fadeInSeconds}[aout]`,
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
      await runFfmpeg(musicOnlyFallbackArgs);
    }

    await replaceFileWithRetries(tempOutput, outputClipPath);
  } finally {
    await fs.rm(tempMusic, { force: true }).catch(() => null);
    await fs.rm(tempOutput, { force: true }).catch(() => null);
  }

  return generated;
}

async function main() {
  const config = await readJson(CONFIG_PATH);
  const musicConfig = normalizeMusicConfig(config);
  const cleanFiles = await fs.readdir(CLEAN_OUTPUT_DIR).catch(() => []);
  const outputFiles = await fs.readdir(OUTPUT_DIR).catch(() => []);
  const ytPattern = /^clip-\d+-yt\.mp4$/i;
  const legacyPattern = /^clip-\d+\.mp4$/i;
  const sourceDir = cleanFiles.some((file) => ytPattern.test(file))
    ? CLEAN_OUTPUT_DIR
    : OUTPUT_DIR;
  const files = sourceDir === CLEAN_OUTPUT_DIR ? cleanFiles : outputFiles;
  const clipFiles = files
    .filter((file) => ytPattern.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const fallbackLegacyClipFiles = files
    .filter((file) => legacyPattern.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const targetClipFiles =
    clipFiles.length > 0 ? clipFiles : fallbackLegacyClipFiles;

  if (targetClipFiles.length === 0) {
    throw new Error("No rendered clip files found in Outputs/.");
  }

  if (sourceDir !== CLEAN_OUTPUT_DIR) {
    console.warn(
      "Warning: Outputs/clean was not found. Re-render clips before adding music to avoid layering new music over old music.",
    );
  }

  for (let index = 0; index < targetClipFiles.length; index += 1) {
    const file = targetClipFiles[index];
    const sourceClipPath = path.join(sourceDir, file);
    const outputClipPath = path.join(OUTPUT_DIR, file);
    console.log(
      `Adding background music to ${file} (volume ${musicConfig.minVolume}-${musicConfig.maxVolume})...`,
    );
    const generated = await mixMusicIntoClip(sourceClipPath, outputClipPath, musicConfig, {
      fileName: file,
      index,
    });
    console.log(`Generated ${generated.name} at ${generated.bpm} BPM for ${file}.`);
  }

  console.log("Background music added to all rendered clips.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
