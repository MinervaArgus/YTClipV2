import React from "react";
import {
  AbsoluteFill,
  Composition,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import clipsData from "../data/clips.json";
import transcriptData from "../data/transcript.json";

type Clip = {
  start: number;
  end: number;
  hook: string;
  title: string;
};

type Segment = {
  start: number;
  end: number;
  text: string;
};

type ClipCaption = {
  start: number;
  end: number;
  text: string;
};

const FPS = 30;
const EMPTY_DURATION_FRAMES = FPS * 3;
const CAPTION_LEAD_SECONDS = 0.04;
const MIN_CAPTION_DURATION_SECONDS = 0.2;
const TAU = Math.PI * 2;

type VisualVariant = {
  name: string;
  tintA: string;
  tintB: string;
  labelBg: string;
  labelBorder: string;
  captionHot: string;
  frameStroke: string;
  captionBg: string;
  captionY: number;
  motionX: number;
  motionY: number;
  grainOpacity: number;
  frameInset: number;
  cardRadius: number;
  cardBorder: string;
  foregroundFilter: string;
  lightLeakA: string;
  lightLeakB: string;
};

const normalizeClips = (): Clip[] => {
  const source = (clipsData as { clips?: Clip[] }).clips ?? [];
  return source
    .map((clip) => ({
      ...clip,
      start: Number(clip.start),
      end: Number(clip.end),
      hook: String(clip.hook ?? "").trim(),
      title: String(clip.title ?? "").trim(),
    }))
    .filter(
      (clip) =>
        Number.isFinite(clip.start) &&
        Number.isFinite(clip.end) &&
        clip.end > clip.start,
    );
};

const normalizeTranscript = (): Segment[] => {
  const source = (transcriptData as { segments?: Segment[] }).segments ?? [];
  return source
    .map((segment) => ({
      start: Number(segment.start),
      end: Number(segment.end),
      text: String(segment.text ?? "").trim(),
    }))
    .filter(
      (segment) =>
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.end > segment.start &&
        segment.text.length > 0,
    );
};

const clips = normalizeClips();
const transcript = normalizeTranscript();

const VISUAL_VARIANTS: VisualVariant[] = [
  {
    name: "Neon Cut",
    tintA: "rgba(93, 214, 255, 0.2)",
    tintB: "rgba(158, 103, 255, 0.2)",
    labelBg: "rgba(10, 24, 52, 0.72)",
    labelBorder: "rgba(127, 221, 255, 0.72)",
    captionHot: "#95ecff",
    frameStroke: "rgba(127, 221, 255, 0.46)",
    captionBg: "rgba(8, 20, 40, 0.56)",
    captionY: 96,
    motionX: 1.1,
    motionY: 1,
    grainOpacity: 0.06,
    frameInset: 28,
    cardRadius: 42,
    cardBorder: "rgba(122, 229, 255, 0.6)",
    foregroundFilter: "contrast(1.12) saturate(1.12) hue-rotate(-6deg)",
    lightLeakA: "rgba(110, 230, 255, 0.22)",
    lightLeakB: "rgba(149, 114, 255, 0.2)",
  },
  {
    name: "Punch Film",
    tintA: "rgba(255, 192, 95, 0.2)",
    tintB: "rgba(255, 110, 135, 0.18)",
    labelBg: "rgba(58, 20, 16, 0.72)",
    labelBorder: "rgba(255, 180, 110, 0.72)",
    captionHot: "#ffd47f",
    frameStroke: "rgba(255, 193, 120, 0.44)",
    captionBg: "rgba(40, 20, 12, 0.58)",
    captionY: 108,
    motionX: 0.9,
    motionY: 1.1,
    grainOpacity: 0.07,
    frameInset: 32,
    cardRadius: 36,
    cardBorder: "rgba(255, 196, 126, 0.58)",
    foregroundFilter: "contrast(1.1) saturate(0.96) sepia(0.12)",
    lightLeakA: "rgba(255, 195, 120, 0.22)",
    lightLeakB: "rgba(255, 132, 92, 0.18)",
  },
  {
    name: "Matrix Pop",
    tintA: "rgba(123, 255, 175, 0.18)",
    tintB: "rgba(73, 190, 255, 0.2)",
    labelBg: "rgba(14, 40, 27, 0.72)",
    labelBorder: "rgba(123, 255, 175, 0.72)",
    captionHot: "#a2ffba",
    frameStroke: "rgba(123, 255, 175, 0.42)",
    captionBg: "rgba(12, 36, 24, 0.58)",
    captionY: 90,
    motionX: 1.2,
    motionY: 0.9,
    grainOpacity: 0.05,
    frameInset: 24,
    cardRadius: 34,
    cardBorder: "rgba(132, 255, 177, 0.58)",
    foregroundFilter: "contrast(1.14) saturate(1.06) hue-rotate(4deg)",
    lightLeakA: "rgba(132, 255, 177, 0.2)",
    lightLeakB: "rgba(90, 193, 255, 0.18)",
  },
  {
    name: "Royal Vibe",
    tintA: "rgba(225, 139, 255, 0.18)",
    tintB: "rgba(136, 168, 255, 0.2)",
    labelBg: "rgba(38, 20, 62, 0.72)",
    labelBorder: "rgba(223, 163, 255, 0.72)",
    captionHot: "#f0b2ff",
    frameStroke: "rgba(213, 157, 255, 0.44)",
    captionBg: "rgba(32, 16, 48, 0.58)",
    captionY: 102,
    motionX: 1,
    motionY: 1.2,
    grainOpacity: 0.065,
    frameInset: 30,
    cardRadius: 44,
    cardBorder: "rgba(216, 165, 255, 0.58)",
    foregroundFilter: "contrast(1.1) saturate(1.08) hue-rotate(-4deg)",
    lightLeakA: "rgba(218, 152, 255, 0.2)",
    lightLeakB: "rgba(144, 173, 255, 0.18)",
  },
];

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const getVisualVariant = (clip: Clip, clipIndex: number): VisualVariant => {
  const key = `${clip.title}|${clip.hook}|${clip.start}|${clip.end}|${clipIndex}`;
  const idx = hashString(key) % VISUAL_VARIANTS.length;
  return VISUAL_VARIANTS[idx];
};

const getDurationInFrames = (clip: Clip) =>
  Math.max(1, Math.round((clip.end - clip.start) * FPS));

const sanitizeCaptionText = (text: string): string => {
  // Remove non-speech tags like [MUSIC], [APPLAUSE], [LAUGHTER], etc.
  return text
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const getClipCaptions = (clip: Clip): ClipCaption[] => {
  const raw = transcript
    .filter((segment) => segment.end > clip.start && segment.start < clip.end)
    .map((segment) => {
      const clippedStart = Math.max(0, segment.start - clip.start);
      const clippedEnd = Math.max(0, Math.min(clip.end, segment.end) - clip.start);
      const text = sanitizeCaptionText(segment.text);
      const start = Math.max(0, clippedStart - CAPTION_LEAD_SECONDS);
      const naturalEnd = Math.min(clip.end - clip.start, clippedEnd);
      const end = Math.max(start + MIN_CAPTION_DURATION_SECONDS, naturalEnd);
      return {
        start,
        end,
        text,
      };
    })
    .filter(
      (caption) => caption.text.length > 0 && caption.end > caption.start,
    );

  // Prevent overlap so stale text does not linger over the next spoken line.
  const resolved: ClipCaption[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const current = raw[i];
    const next = raw[i + 1];
    if (!next) {
      resolved.push(current);
      continue;
    }
    resolved.push({
      ...current,
      end: Math.min(current.end, Math.max(current.start + 0.01, next.start)),
    });
  }

  return resolved.filter((caption) => caption.end > caption.start);
};

const ClipOnlyWithCaptions: React.FC<{
  clipIndex: number;
  styleMode?: "og" | "yt";
}> = ({ clipIndex, styleMode = "yt" }) => {
  const frame = useCurrentFrame();
  const clip = clips[clipIndex];

  if (!clip) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#101425",
          color: "#fff",
          justifyContent: "center",
          alignItems: "center",
          fontFamily: "Verdana, sans-serif",
          fontSize: 44,
          textAlign: "center",
          padding: 40,
        }}
      >
        Missing clip data for this composition.
      </AbsoluteFill>
    );
  }

  const clipFile = staticFile(`assets/clip-${String(clipIndex + 1).padStart(2, "0")}.mp4`);
  const timeInSeconds = frame / FPS;
  const captions = getClipCaptions(clip);
  const variant = getVisualVariant(clip, clipIndex);
  const isOg = styleMode === "og";
  let currentCaption: ClipCaption | null = null;
  for (let i = captions.length - 1; i >= 0; i -= 1) {
    const caption = captions[i];
    if (timeInSeconds >= caption.start && timeInSeconds < caption.end) {
      currentCaption = caption;
      break;
    }
  }
  const captionProgress = currentCaption
    ? (timeInSeconds - currentCaption.start) /
      Math.max(0.01, currentCaption.end - currentCaption.start)
    : 0;
  const captionScale =
    currentCaption && captionProgress >= 0 && captionProgress <= 1
      ? interpolate(captionProgress, [0, 0.14, 1], [0.92, 1.03, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;
  const pulse = 0.5 + 0.5 * Math.sin((frame / FPS) * TAU * 0.12);
  const pushScale = isOg ? 1.006 : 1.02 + pulse * 0.016;
  const driftX = isOg
    ? 0
    : Math.sin((frame / FPS) * TAU * 0.06) * 10 * variant.motionX;
  const driftY = isOg
    ? 0
    : Math.cos((frame / FPS) * TAU * 0.05) * 8 * variant.motionY;
  const microRotate = isOg ? 0 : Math.sin((frame / FPS) * TAU * 0.04) * 0.7;
  const titleLabel = clip.title || variant.name;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <OffthreadVideo
        src={clipFile}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: isOg ? "scale(1.04)" : `scale(${1.08 + pulse * 0.025})`,
          filter: isOg
            ? "blur(18px) brightness(0.6) saturate(1.02)"
            : "blur(24px) brightness(0.56) saturate(1.2)",
        }}
      />
      <AbsoluteFill
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.1) 45%, rgba(0, 0, 0, 0.55) 100%)",
        }}
      />
      {!isOg ? (
        <>
          <AbsoluteFill
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              backgroundImage:
                "radial-gradient(rgba(255,255,255,0.28) 0.6px, transparent 0.6px)",
              backgroundSize: "3px 3px",
              opacity: variant.grainOpacity,
              mixBlendMode: "soft-light",
            }}
          />
          <AbsoluteFill
            style={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(circle at 20% 18%, ${variant.tintA} 0%, rgba(0,0,0,0) 52%), radial-gradient(circle at 82% 76%, ${variant.tintB} 0%, rgba(0,0,0,0) 56%)`,
              mixBlendMode: "screen",
              opacity: 0.88,
            }}
          />
          <AbsoluteFill
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: `linear-gradient(120deg, rgba(0,0,0,0) 12%, ${variant.lightLeakA} 38%, rgba(0,0,0,0) 58%), linear-gradient(300deg, rgba(0,0,0,0) 8%, ${variant.lightLeakB} 42%, rgba(0,0,0,0) 66%)`,
              mixBlendMode: "screen",
              opacity: 0.75,
            }}
          />
          <AbsoluteFill
            style={{
              position: "absolute",
              inset: 20,
              border: `2px solid ${variant.frameStroke}`,
              borderRadius: 24,
              boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.35) inset",
              pointerEvents: "none",
            }}
          />
        </>
      ) : null}
      <AbsoluteFill
        style={{
          position: "absolute",
          inset: isOg ? 0 : variant.frameInset,
          borderRadius: isOg ? 0 : variant.cardRadius,
          overflow: "hidden",
          border: isOg ? "none" : `2px solid ${variant.cardBorder}`,
          boxShadow: isOg
            ? "none"
            : "0 28px 70px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08) inset",
          transform: `translate(${driftX}px, ${driftY}px) rotate(${microRotate}deg)`,
        }}
      >
        <OffthreadVideo
          src={clipFile}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: isOg ? "contain" : "cover",
            transform: `scale(${pushScale})`,
            filter: isOg ? "contrast(1.04) saturate(1.01)" : variant.foregroundFilter,
          }}
        />
        {!isOg ? (
          <OffthreadVideo
            src={clipFile}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${pushScale + 0.03}) translate(${driftX * 0.3}px, ${driftY * -0.3}px)`,
              filter: "blur(10px) saturate(1.35)",
              opacity: 0.16,
              mixBlendMode: "screen",
            }}
          />
        ) : null}
      </AbsoluteFill>
      {!isOg ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "flex-start",
            paddingTop: 48,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              maxWidth: "86%",
              padding: "10px 18px",
              borderRadius: 999,
              border: `2px solid ${variant.labelBorder}`,
              background: variant.labelBg,
              color: "#fff",
              textTransform: "uppercase",
              letterSpacing: 1.1,
              fontWeight: 700,
              fontSize: 26,
              textAlign: "center",
              textShadow: "0 2px 8px rgba(0,0,0,0.55)",
            }}
          >
            {titleLabel}
          </div>
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          padding: `0 48px ${variant.captionY}px`,
        }}
      >
        {currentCaption ? (
          <div
            style={{
              color: currentCaption.text.length <= 16 ? variant.captionHot : "#ffffff",
              fontFamily: "Verdana, sans-serif",
              fontSize: 54,
              lineHeight: 1.1,
              fontWeight: 700,
              textAlign: "center",
              textTransform: "uppercase",
              transform: `scale(${captionScale})`,
              textShadow:
                "0 4px 0 rgba(0, 0, 0, 0.95), 0 0 12px rgba(0, 0, 0, 0.9), 0 0 30px rgba(0, 0, 0, 0.82)",
              backgroundColor: isOg ? "rgba(0, 0, 0, 0.44)" : variant.captionBg,
              borderRadius: 18,
              border: isOg
                ? "1px solid rgba(255,255,255,0.28)"
                : `1.5px solid ${variant.labelBorder}`,
              padding: "14px 24px",
              maxWidth: "95%",
            }}
          >
            {currentCaption.text}
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const EmptyComposition: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundColor: "#101425",
      color: "#fff",
      justifyContent: "center",
      alignItems: "center",
      fontFamily: "Verdana, sans-serif",
      fontSize: 42,
      textAlign: "center",
      padding: 40,
    }}
  >
    No clips found in data/clips.json
  </AbsoluteFill>
);

export const RemotionRoot: React.FC = () => {
  if (clips.length === 0) {
    return (
      <Composition
        id="YTClip-Empty"
        component={EmptyComposition}
        durationInFrames={EMPTY_DURATION_FRAMES}
        fps={FPS}
        width={1080}
        height={1920}
      />
    );
  }

  return (
    <>
      {clips.map((clip, index) => (
        <React.Fragment key={`clip-${index + 1}`}>
          <Composition
            id={`YTClip-${String(index + 1).padStart(2, "0")}-OG`}
            component={ClipOnlyWithCaptions}
            durationInFrames={getDurationInFrames(clip)}
            fps={FPS}
            width={1080}
            height={1920}
            defaultProps={{ clipIndex: index, styleMode: "og" }}
          />
          <Composition
            id={`YTClip-${String(index + 1).padStart(2, "0")}-YT`}
            component={ClipOnlyWithCaptions}
            durationInFrames={getDurationInFrames(clip)}
            fps={FPS}
            width={1080}
            height={1920}
            defaultProps={{ clipIndex: index, styleMode: "yt" }}
          />
        </React.Fragment>
      ))}
    </>
  );
};
