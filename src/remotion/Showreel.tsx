// The Remotion composition (Agent Orchestration reel) — audio is the master
// timeline; visuals are paced to it with short holds so each move lands.
//
//   card  -> motion graphic (animated agent-chain / architecture / outro)
//   beat  -> eased ZOOM-TO-ELEMENT on the focal bbox + an outline callout
//            (or a slow Ken Burns drift when there's no focal element)
//   action-> the recorded clip over a held base still (no black first frame),
//            speed-fit to its window with a post-frame freeze for any gap
//
// Polish rules baked in (see showreel-polish-notes):
//   1. No black flashes — base BG is deep forest (never #000); every action lays
//      its captured still UNDER the video so a decode gap never shows black.
//   2. Captions are ONE overlay track outside the TransitionSeries, tiled to
//      non-overlapping windows so a caption is on screen the whole time and two
//      lines never cross-dissolve over each other.
//   3. Cards are never a blank screen under narration — they animate from the
//      first frame (graphic present at frame 0; elements move into place).

import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Manifest, Segment } from "../types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const easeCubicInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

// Palette — matches the app (warm cream / forest-green / terracotta / amber).
const BG = "#101a17"; // deep forest base (NEVER black) — see polish rule 1
const CARD_A = "#16241f";
const CARD_B = "#0d1714";
const INK = "#f8f3e7"; // cream
const MUTE = "#cfd8d0";
const TERRA = "#d95f36"; // terracotta — brand / agents
const AMBER = "#f0b65b"; // amber — accent / data
const NODE = "#1f322e";
const NODE_BORDER = "#3d5852";

const TRANSITION_FRAMES = 15; // 0.5s crossfade
const HOLD_SECONDS: Record<Segment["kind"], number> = { card: 1.2, beat: 1.0, action: 0.7 };

const FONT = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

export function segmentFrames(seg: Segment, fps: number): number {
  const audio = Math.max(1, Math.round((seg.audio?.seconds ?? 0) * fps));
  return audio + Math.round(HOLD_SECONDS[seg.kind] * fps);
}
export function usableSegments(m: Manifest): Segment[] {
  return m.segments.filter((s) => s.status !== "blocked" && s.audio);
}
export function totalFrames(m: Manifest, fps: number): number {
  const segs = usableSegments(m);
  const sum = segs.reduce((t, s) => t + segmentFrames(s, fps), 0);
  return Math.max(1, sum - Math.max(0, segs.length - 1) * TRANSITION_FRAMES);
}

// ---- Beat: zoom-to-element + outline callout, or Ken Burns drift ------------
function Beat({ seg, frames }: { seg: Segment; frames: number }) {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const src = staticFile(seg.capture.frame ?? seg.capture.postFrame ?? "");
  const bbox = seg.capture.bbox;

  const ZOOM_IN = 28;

  let tx = 0;
  let ty = 0;
  let s = 1;
  let ex = 0;
  let ey = 0;
  let ew = 0;
  let eh = 0;

  if (bbox) {
    const padX = W * 0.07;
    const padY = H * 0.07;
    let fx = bbox.x - padX;
    let fy = bbox.y - padY;
    let fw = bbox.width + padX * 2;
    let fh = bbox.height + padY * 2;
    const minW = W * 0.32;
    const minH = H * 0.24;
    if (fw < minW) { fx -= (minW - fw) / 2; fw = minW; }
    if (fh < minH) { fy -= (minH - fh) / 2; fh = minH; }
    fw = Math.min(fw, W); fh = Math.min(fh, H);
    fx = clamp(fx, 0, W - fw); fy = clamp(fy, 0, H - fh);

    const target = clamp(Math.min((W * 0.82) / fw, (H * 0.82) / fh), 1.05, 2.2);
    const cx = fx + fw / 2;
    const cy = fy + fh / 2;
    const txEnd = clamp(W / 2 - cx * target, W - W * target, 0);
    const tyEnd = clamp(H / 2 - cy * target, H - H * target, 0);
    const p = interpolate(frame, [0, ZOOM_IN], [0, 1], {
      easing: Easing.inOut(Easing.cubic),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    s = 1 + (target - 1) * p;
    tx = txEnd * p;
    ty = tyEnd * p;
    ex = bbox.x * s + tx;
    ey = bbox.y * s + ty;
    ew = bbox.width * s;
    eh = bbox.height * s;
  } else {
    // No focal element: slow Ken Burns so the establishing shot stays alive.
    s = interpolate(frame, [0, frames], [1.0, 1.06], { extrapolateRight: "clamp" });
    tx = interpolate(frame, [0, frames], [0, -W * 0.012], { extrapolateRight: "clamp" });
    ty = interpolate(frame, [0, frames], [0, -H * 0.012], { extrapolateRight: "clamp" });
  }

  const outlineOpacity = bbox
    ? interpolate(frame, [ZOOM_IN - 8, ZOOM_IN + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 0;
  const labelAbove = ey > 80;

  return (
    <AbsoluteFill style={{ backgroundColor: BG, overflow: "hidden" }}>
      <div style={{ position: "absolute", width: W, height: H, transform: `translate(${tx}px, ${ty}px) scale(${s})`, transformOrigin: "0 0" }}>
        <Img src={src} style={{ width: W, height: H, objectFit: "cover", display: "block" }} />
      </div>
      {bbox && (
        <div
          style={{
            position: "absolute",
            left: ex,
            top: ey,
            width: ew,
            height: eh,
            border: `3px solid ${TERRA}`,
            borderRadius: 12,
            boxShadow: `0 0 0 2px rgba(217,95,54,0.18), 0 0 30px rgba(217,95,54,0.40)`,
            opacity: outlineOpacity,
          }}
        >
          {seg.highlight && (
            <div
              style={{
                position: "absolute",
                left: -3,
                [labelAbove ? "bottom" : "top"]: -46,
                background: TERRA,
                color: "#fff7f1",
                fontWeight: 700,
                fontSize: 24,
                padding: "7px 15px",
                borderRadius: 10,
                whiteSpace: "nowrap",
                fontFamily: FONT,
                boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
              }}
            >
              {seg.highlight}
            </div>
          )}
        </div>
      )}
    </AbsoluteFill>
  );
}

// ---- Action: held base still + trimmed, speed-fit clip + freeze ------------
function Action({ seg, frames }: { seg: Segment; frames: number }) {
  const { fps } = useVideoConfig();
  const clip = seg.capture.clip;
  const video = seg.capture.video;
  const base = seg.capture.postFrame ?? seg.capture.frame; // under the clip → no black first frame
  if (!clip || !video) return <Beat seg={seg} frames={frames} />;

  const lead = 0.3;
  const tail = 0.3;
  const sourceFrames = Math.round((clip.durationMs / 1000) * fps);
  const a = clamp(Math.round((clip.startMs / 1000 - lead) * fps), 0, sourceFrames);
  let b = clamp(Math.round((clip.endMs / 1000 + tail) * fps), a + 1, sourceFrames);

  const rate = clamp((b - a) / frames, 0.5, 2.0);
  let videoFrames = Math.round((b - a) / rate);
  if (videoFrames > frames) {
    b = a + Math.round(frames * rate);
    videoFrames = frames;
  }
  videoFrames = Math.min(videoFrames, frames);

  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      {base && <Img src={staticFile(base)} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover" }} />}
      <Sequence durationInFrames={videoFrames}>
        <OffthreadVideo src={staticFile(video)} trimBefore={a} trimAfter={b} playbackRate={rate} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </Sequence>
      {videoFrames < frames && base && (
        <Sequence from={videoFrames} durationInFrames={frames - videoFrames}>
          <Img src={staticFile(base)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
}

// ---- Card backdrop (present from frame 0 — never blank) ---------------------
function cardBg(): React.CSSProperties {
  return { background: `radial-gradient(130% 100% at 50% 14%, ${CARD_A} 0%, ${CARD_B} 70%)` };
}

// Animated chain of agents handing work down a line. Lit and moving from frame 0.
function AgentChain({ flow }: { flow: boolean }) {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const n = 3;
  const cx = [W * 0.27, W * 0.5, W * 0.73];
  const cy = H * 0.64;
  const nodeW = 230;
  const nodeH = 128;
  const accents = [TERRA, AMBER, TERRA];

  const EDGE = 44; // frames per hop
  const u = frame / EDGE;
  const edge = ((Math.floor(u) % (n - 1)) + (n - 1)) % (n - 1);
  const t = u - Math.floor(u);
  const te = easeCubicInOut(t);
  const tokenX = cx[edge] + (cx[edge + 1] - cx[edge]) * te;
  const tokenOp = flow ? clamp(Math.sin(Math.PI * t), 0.0, 1) : 0;

  const activation = (i: number): number => {
    if (!flow) return 0.5 + 0.32 * Math.sin(frame / 16 + i * 1.1);
    let act = 0.18;
    if (i === edge) act = Math.max(act, 1 - t);
    if (i === edge + 1) act = Math.max(act, t);
    return act;
  };

  return (
    <AbsoluteFill>
      {/* edges */}
      {Array.from({ length: n - 1 }).map((_, i) => {
        const x1 = cx[i] + nodeW / 2;
        const x2 = cx[i + 1] - nodeW / 2;
        const lit = flow && i === edge;
        return (
          <div
            key={`e${i}`}
            style={{
              position: "absolute",
              left: x1,
              top: cy - 2,
              width: x2 - x1,
              height: 4,
              borderRadius: 2,
              background: lit ? AMBER : "rgba(207,216,208,0.22)",
              boxShadow: lit ? `0 0 16px ${AMBER}` : "none",
            }}
          />
        );
      })}
      {/* nodes */}
      {cx.map((x, i) => {
        const a = clamp(activation(i), 0, 1);
        return (
          <div
            key={`n${i}`}
            style={{
              position: "absolute",
              left: x - nodeW / 2,
              top: cy - nodeH / 2,
              width: nodeW,
              height: nodeH,
              borderRadius: 18,
              background: NODE,
              border: `2px solid ${a > 0.4 ? accents[i] : NODE_BORDER}`,
              boxShadow: a > 0.4 ? `0 0 ${10 + a * 34}px rgba(217,95,54,${0.18 + a * 0.4})` : "0 8px 24px rgba(0,0,0,0.30)",
              transform: `scale(${1 + a * 0.07})`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              fontFamily: FONT,
            }}
          >
            <div style={{ width: 38, height: 38, borderRadius: 10, background: accents[i], opacity: 0.85 }} />
            <div style={{ color: INK, fontSize: 22, fontWeight: 700 }}>Agent</div>
          </div>
        );
      })}
      {/* travelling message token */}
      {flow && (
        <div
          style={{
            position: "absolute",
            left: tokenX - 11,
            top: cy - 11,
            width: 22,
            height: 22,
            borderRadius: 11,
            background: AMBER,
            opacity: tokenOp,
            boxShadow: `0 0 22px ${AMBER}, 0 0 8px #fff`,
          }}
        />
      )}
    </AbsoluteFill>
  );
}

function TitleCard({ seg, outro }: { seg: Segment; outro?: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const card = seg.card!;
  const rise = spring({ frame, fps, config: { damping: 200 } });
  const subRise = spring({ frame: frame - 8, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ ...cardBg(), fontFamily: FONT }}>
      <AgentChain flow={!outro} />
      <div style={{ position: "absolute", top: H_PCT(0.2), left: 0, right: 0, textAlign: "center" }}>
        <div style={{ color: TERRA, fontSize: 26, letterSpacing: 7, fontWeight: 700, opacity: subRise, marginBottom: 14 }}>
          {outro ? "THANKS FOR WATCHING" : "AGENT ORCHESTRATION"}
        </div>
        <div style={{ color: INK, fontSize: 92, fontWeight: 800, transform: `translateY(${(1 - rise) * 28}px)`, opacity: rise }}>
          {card.title}
        </div>
        {card.subtitle && (
          <div style={{ color: MUTE, fontSize: 34, marginTop: 20, opacity: subRise, maxWidth: 1280, marginLeft: "auto", marginRight: "auto", lineHeight: 1.35 }}>
            {card.subtitle}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}

// percentage of 1080 height helper (kept inline to avoid a hook here)
function H_PCT(p: number): number {
  return Math.round(1080 * p);
}

function DiagramCard({ seg }: { seg: Segment }) {
  const frame = useCurrentFrame();
  const { fps, width: W } = useVideoConfig();
  const card = seg.card!;
  const img = seg.capture.frame;
  const titleRise = spring({ frame, fps, config: { damping: 200 } });
  const imgIn = spring({ frame: frame - 6, fps, config: { damping: 200 } });
  // a soft highlight band sweeps across the diagram once
  const sweepX = interpolate(frame, [10, 70], [-0.3, 1.3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) * W;
  return (
    <AbsoluteFill style={{ ...cardBg(), alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
      <div style={{ color: INK, fontSize: 52, fontWeight: 800, opacity: titleRise, transform: `translateY(${(1 - titleRise) * 18}px)`, marginBottom: 4 }}>{card.title}</div>
      {card.subtitle && <div style={{ color: MUTE, fontSize: 26, opacity: titleRise, marginBottom: 26 }}>{card.subtitle}</div>}
      {img && (
        <div style={{ position: "relative", maxWidth: "86%", maxHeight: "62%", opacity: imgIn, transform: `scale(${0.96 + imgIn * 0.04})` }}>
          <Img src={staticFile(img)} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
          <div style={{ position: "absolute", top: 0, bottom: 0, left: sweepX, width: 180, background: "linear-gradient(90deg, transparent, rgba(240,182,91,0.16), transparent)", pointerEvents: "none" }} />
        </div>
      )}
    </AbsoluteFill>
  );
}

function CardView({ seg }: { seg: Segment }) {
  if (seg.card?.variant === "diagram") return <DiagramCard seg={seg} />;
  return <TitleCard seg={seg} outro={seg.card?.variant === "outro"} />;
}

// ---- Captions (single overlay track, tiled — see polish rule 2) ------------
function Caption({ text, frames, fadeIn, fadeOut }: { text: string; frames: number; fadeIn: boolean; fadeOut: boolean }) {
  const frame = useCurrentFrame();
  let opacity = 1;
  if (fadeIn) opacity *= interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  if (fadeOut) opacity *= interpolate(frame, [frames - 12, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 56 }}>
      <div
        style={{
          maxWidth: 1400,
          margin: "0 60px",
          padding: "16px 30px",
          borderRadius: 16,
          background: "rgba(12,20,17,0.82)",
          border: `1px solid rgba(217,95,54,0.30)`,
          color: INK,
          fontSize: 30,
          lineHeight: 1.4,
          textAlign: "center",
          fontFamily: FONT,
          opacity,
          boxShadow: "0 10px 34px rgba(0,0,0,0.40)",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
}

// ---- Assembly ---------------------------------------------------------------
export function Showreel({ manifest }: { manifest: Manifest }) {
  const { fps } = useVideoConfig();
  const segs = usableSegments(manifest);

  // Caption windows: tile the timeline with NO overlap. Each segment occupies
  // frames; adjacent segments overlap by TRANSITION_FRAMES in the visual
  // TransitionSeries, so a caption's solo window is (frames - T) except the last.
  const starts: number[] = [];
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    starts.push(acc);
    const f = segmentFrames(segs[i], fps);
    acc += i < segs.length - 1 ? f - TRANSITION_FRAMES : f;
  }
  const durOf = (i: number) =>
    i < segs.length - 1 ? segmentFrames(segs[i], fps) - TRANSITION_FRAMES : segmentFrames(segs[i], fps);

  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <TransitionSeries>
        {segs.flatMap((seg, i) => {
          const frames = segmentFrames(seg, fps);
          const visual =
            seg.kind === "card" ? <CardView seg={seg} /> : seg.kind === "action" ? <Action seg={seg} frames={frames} /> : <Beat seg={seg} frames={frames} />;
          const node = (
            <TransitionSeries.Sequence key={seg.stepId} durationInFrames={frames}>
              {visual}
              {seg.audio && <Audio src={staticFile(seg.audio.path)} />}
            </TransitionSeries.Sequence>
          );
          if (i === segs.length - 1) return [node];
          return [
            node,
            <TransitionSeries.Transition key={`${seg.stepId}-t`} presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })} />,
          ];
        })}
      </TransitionSeries>

      {/* Captions: one overlay track, tiled windows — always present, never overlapping */}
      {segs.map((seg, i) =>
        seg.narration ? (
          <Sequence key={`cap-${seg.stepId}`} from={starts[i]} durationInFrames={durOf(i)}>
            <Caption text={seg.narration} frames={durOf(i)} fadeIn={i === 0} fadeOut={i === segs.length - 1} />
          </Sequence>
        ) : null,
      )}
    </AbsoluteFill>
  );
}
