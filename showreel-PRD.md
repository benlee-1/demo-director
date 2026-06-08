# PRD — Showreel

_A tool that turns a built app into a polished, narrated demo video by driving it
through Playwright, capturing the result, and synthesizing voiceover._
_(Rename freely. Working name only.)_

## Why this, why now

Demo videos are high-value and high-friction: every partner project, portfolio piece,
README, and App Store listing wants one, and producing one by hand (script, screen-record,
re-record the fumbles, write narration, record VO, edit, sync) is hours per app. The
inputs already exist in the repo — the routes, the flows, the e2e tests. Showreel turns
that latent structure into a finished artifact.

It is also the **Atelier dogfood**: it leans hard on Playwright (which Atelier needs
anyway), the reusable pieces (Playwright capture harness, TTS client, render glue) become
reference-corpus exemplars, and its plan→approve→execute shape mirrors Atelier's own.

## Users & use cases

Primary user: me. Outputs: 60–120s demo reels for Gauntlet partner projects, portfolio,
README headers, App Store previews. Secondary (later): a reusable tool others could run.

## The decisions that determine whether this works

These four calls shape the whole build; everything else is implementation.

### 1. Audio is the master timeline (not the video)

TTS narration length never matches raw interaction timing, so one side must yield. Generate
**script → audio → measured durations first**, then pace visuals to the audio. This dissolves
the sync problem instead of fighting it: each storyboard segment owns a narration clip of
known length, and the visual for that segment is fit to that length. The reverse (capture
video, then time narration to it) is far harder and produces dead air. This is the single
most important decision in the PRD.

### 2. The repo is the discovery signal, not the running UI

A running app doesn't announce what's worth demoing; the *code* does. Showreel reads the
repo — routes, page/component files, existing Playwright/e2e specs, README, package.json —
to **propose** a storyboard (ordered flows + steps), which I approve/edit before anything
runs. Existing e2e specs are gold: they're already a curated list of what matters. This is
hybrid discovery (agent proposes, human gates, machine executes) — reliable where pure
auto-explore is fragile, and it matches Atelier's pattern.

### 3. Hybrid visual model: typed segments

Every storyboard segment is one of two types, which decides how it's rendered:
- **`action`** — a real interaction (click, type, navigate). Captured as Playwright video,
  then speed-ramped/eased to fit its narration clip. Shows the app actually working.
- **`beat`** — a narration moment with no interaction (intro, "here's the dashboard",
  feature callout). Rendered as a held frame (screenshot) with slow zoom/pan (Ken Burns)
  and optional callout annotation. Gives the script room to breathe and looks intentional.

Polish comes from synthesized motion on top of both: eased cursor movement, click ripple,
zoom-to-element, consistent viewport, title/outro cards, transitions.

### 4. Self-boot is bounded, URL is preferred

Getting an arbitrary repo *running* is the biggest reliability risk in the product — there
is no universal solution (deps, env, DB, ports, migrations, build steps). So:
- If a **deployed/running URL** is provided or discoverable (env, README, vercel/netlify
  config), use it. Always the happy path.
- Else **self-boot**, but scoped: detect common stacks (package.json `dev`/`start`,
  `docker-compose.yml`, Next/Vite/CRA), install, launch, health-check the port with a
  timeout. On any failure, **fall back to asking me for a URL** rather than flailing.
Self-boot is best-effort convenience, never a hard dependency of the pipeline.

## Pipeline

```
repo ──▶ 1. Discover ──▶ [storyboard]──approve──▶ 2. Resolve/Boot ──▶ 3. Capture
                                                                          │
   mp4 ◀── 6. Compose ◀── 5. Voiceover ◀── 4. Script ◀────────────────────┘
                                              (audio = master timeline)
```

**1. Discover.** Read repo → propose `StoryBoard` (flows, ordered steps, each step a
selector/action or a beat). Reuse existing Playwright specs as flow sources when present.
Emit for my review; I edit/approve. (Intake-style gate.)

**2. Resolve / Boot.** Resolve target URL (deployed-first, self-boot fallback). Resolve
prerequisites into an intake: app credentials (a test account so authed flows have
content), seed data, env vars. Presence-checked, never logged — same boundary as Atelier's
prerequisite resolution.

**3. Capture.** Drive each step with Playwright against the resolved URL.
- `action` steps: record video (Playwright `recordVideo`) + trace; capture the pre/post
  screenshot and the **visible DOM text** of the step (for script grounding).
- `beat` steps: capture a high-res screenshot.
- Determinism: pinned viewport + deviceScaleFactor (retina), `prefers-reduced-motion`
  forced, wait for network-idle / explicit selectors before capture, stable selectors
  (prefer test-ids; fall back to role/text). Non-determinism here = jittery output.

**4. Script.** Per-segment narration written by an LLM **grounded in that segment's
screenshot + DOM text** (vision), so it describes what's actually on screen, not generic
filler. Output: ordered segments, each with `narration` text + `targetSeconds`. One script
segment per storyboard step keeps audio and visuals on a shared unit. I can edit the script
before VO (cheap to fix here, expensive after).

**5. Voiceover.** Per-segment TTS (ElevenLabs) → audio clip + **measured duration**. Behind
a `TtsProvider` interface (ElevenLabs default; OpenAI TTS / PlayHT swappable) — same
swappable-provider instinct as the model layer. Measured durations set the master timeline.

**6. Compose.** Build the final timeline in Remotion: for each segment, lay its narration
`<Audio>` as the clock, fit its visual (embed `action` video via `<OffthreadVideo>`,
speed-ramped to the clip length; animate `beat` screenshots with zoom/pan) to that length,
overlay cursor/annotations/captions, add title + outro cards and transitions. Render to mp4.
Emit a manifest so any single segment can be re-scripted/re-rendered without redoing the run.

## Stack

- **Language:** TypeScript / Node (Atelier-consistent; Playwright and Remotion are both TS).
- **Capture:** Playwright (video + trace + screenshot + DOM extraction).
- **Composition:** **Remotion** — programmatic, audio-synced, React-defined video. Chosen
  because polish is priority #1 and Remotion is purpose-built for exactly this: audio as a
  first-class timeline, frame-accurate motion (zoom, cursor easing, captions), title cards,
  and `<OffthreadVideo>` to embed the Playwright clips. Raw ffmpeg can do it but the filter
  graph (zoompan + overlay + concat + amix) is brittle and time-sync is manual. ffmpeg stays
  underneath for encoding/muxing and as the no-Remotion fallback.
  - _Licensing note:_ Remotion is free for individuals/small teams, paid above a threshold —
    fine for personal use; revisit if this is ever productized.
- **TTS:** ElevenLabs API via a `TtsProvider` interface (swappable).
- **Script LLM:** Claude with vision (grounds narration on screenshots).
- **Cursor/motion:** synthesized overlay in Remotion (Playwright cursor isn't reliably in
  the recording); animate from element bbox to element bbox.

## Data shapes

```ts
type SegmentKind = "action" | "beat";

interface Step {
  id: string;
  kind: SegmentKind;
  intent: string;                 // "click Subscribe", "show the dashboard"
  action?: { type: "click"|"type"|"navigate"|"hover"; selector?: string; value?: string };
  waitFor?: string;               // selector / "networkidle" before capture
}

interface Flow { id: string; title: string; steps: Step[]; }

interface StoryBoard {
  app: { url?: string; selfBoot?: boolean };
  flows: Flow[];
  intro?: string; outro?: string;
  prerequisites: {                // → intake, presence-checked, never logged
    secrets: { name: string; purpose: string }[];
    credentials?: { loginUrl: string; usernameEnv: string; passwordEnv: string };
    seed?: string;                // note on required seed state
  };
}

interface Segment {              // produced through the pipeline
  stepId: string;
  kind: SegmentKind;
  capture: { video?: string; frame?: string; domText?: string; bbox?: Rect };
  narration?: string;
  audio?: { path: string; seconds: number };   // master-timeline unit
}
```

## The hard parts (named, with mitigations)

- **Self-boot reliability** — the top risk. Mitigation: deployed-URL-first; self-boot only
  for detected common stacks with a health-check timeout and a clean fall-back-to-URL.
- **Auth/seed state** — an authed flow against an empty account demos nothing. Mitigation:
  credentials + seed captured in the intake; v1 assumes a usable test account exists.
- **Capture non-determinism** — flaky selectors, animation, load timing. Mitigation: pinned
  viewport, reduced-motion, explicit waits, test-id-preferred selectors; a failed step
  becomes a `blocked` segment surfaced for me, not a fabricated capture.
- **Narration↔visual sync** — solved by construction via audio-as-master-timeline; the only
  residual is speed-ramping `action` video to fit without looking unnatural (cap the ramp;
  if a clip is much longer than its narration, trim to the salient sub-action).
- **Script quality** — generic narration kills the demo. Mitigation: vision grounding on the
  actual frame + DOM text; human edit pass before VO.
- **Cost** — ElevenLabs per-char + vision calls + render compute. Per-video cost is small;
  note it, don't engineer around it yet.

## Scope

**v0 — thin slice (prove the spine, end-to-end, one hardcoded flow).** Not "ship rough" —
this exists to de-risk the integration before polish. Hand-written storyboard for ONE app
at a provided URL, one 3–4 step flow, audio-master-timeline working, Remotion render to mp4.
If the spine holds (capture → script → VO → synced compose), everything else is additive.

**v1 — the real tool.** Repo discovery → proposed storyboard → my approval; deployed-URL +
bounded self-boot; hybrid action/beat capture; vision-grounded script with edit pass;
ElevenLabs VO; polished Remotion compose (cursor easing, zoom, title/outro, captions);
segment-level re-render. Hits polish (#1) and discovery (#2); speed (#3) is explicitly the
thing we don't optimize.

**Later.** Auto-explore discovery (no repo, just URL); multi-flow reels with chapters; music
bed; brand theming; voice/style presets; web UI; others' repos as input.

## Open questions

- Captions on by default? (accessibility + silent autoplay favor yes.)
- One reel per flow, or one reel stitching all flows with chapter cards? (v1: one flow →
  one reel; revisit.)
- Where does the storyboard live — generated file I edit, or interactive approval? (Lean:
  generated `storyboard.json` + a review pass, Atelier-style.)
- Self-boot: how far to push stack detection before it's a rabbit hole? (Cap at Node + one
  docker-compose path for v1.)

## Dogfood notes (the point of building this)

- Build it **with the reference server active** (Mode 1): query the corpus before writing
  the Playwright capture harness, the ElevenLabs client, the ffmpeg/Remotion glue.
- Capture the reusable units **back into the corpus** as you go (`add_reference`): a
  Playwright video+trace capture wrapper, a `TtsProvider` ElevenLabs impl, a Remotion
  audio-master-timeline composition. These are exactly the cross-project exemplars Atelier
  exists to accumulate.
- Track whether reaching for references actually saved time here — that's the data that
  gates building Atelier's Phase 4 orchestrator.
