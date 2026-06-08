// Data shapes for the Showreel pipeline. Core shapes mirror the PRD §Data shapes;
// Segment/Manifest add the fields the pipeline threads stage-to-stage.

// action = real interaction recorded as video; beat = held frame with a focal
// element; card = synthetic title/outro/diagram screen (no capture).
export type SegmentKind = "action" | "beat" | "card";

export interface CardSpec {
  variant: "title" | "outro" | "diagram";
  title?: string;
  subtitle?: string;
  body?: string;
  image?: string; // relative path to a rendered image (e.g. the arch diagram)
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StepAction {
  type: "click" | "type" | "navigate" | "hover" | "select";
  selector?: string; // Playwright selector string (testid / role=/ css / text=)
  value?: string; // "type": text · "navigate": URL · "select": <option> label
}

export interface Step {
  id: string;
  kind: SegmentKind;
  intent: string; // "click Sign in", "show the dashboard"
  pre?: StepAction[]; // setup actions run (and replayed) before this step's own action
  action?: StepAction; // the salient interaction, present for kind === "action"
  waitFor?: string; // selector or "networkidle" to await before capture
  focus?: string; // beat: selector to scroll into view, zoom to, and outline
  highlight?: string; // beat: short label drawn on the callout
  seconds?: number; // narration length hint (s) handed to the script stage
  card?: CardSpec; // kind === "card": what the synthetic screen shows
}

export interface Flow {
  id: string;
  title: string;
  steps: Step[];
}

export interface StoryBoard {
  app: { url?: string; selfBoot?: boolean };
  flows: Flow[];
  intro?: string;
  outro?: string;
  prerequisites: {
    // -> intake, presence-checked, never logged
    secrets: { name: string; purpose: string }[];
    credentials?: { loginUrl: string; usernameEnv: string; passwordEnv: string };
    seed?: string; // note on required seed state
  };
}

export type SegmentStatus = "pending" | "captured" | "blocked";

export interface Segment {
  stepId: string;
  kind: SegmentKind;
  status: SegmentStatus;
  blockedReason?: string; // why a step could not be captured (never faked)
  capture: {
    video?: string; // action: recorded interaction clip
    frame?: string; // beat: held screenshot; action: pre-frame
    postFrame?: string; // action: post-interaction screenshot (freeze-frame filler)
    domText?: string; // visible DOM text for script grounding
    bbox?: Rect; // target element bounds (zoom-to-element)
    frameSize?: { w: number; h: number }; // px size of the displayed still (filled by render)
    // action: where the salient interaction sits inside the recorded clip,
    // in ms from clip start — lets compose trim lead-in replay to the action.
    clip?: { startMs: number; endMs: number; durationMs: number };
  };
  narration?: string;
  targetSeconds?: number; // script estimate (pre-VO)
  audio?: { path: string; seconds: number }; // measured -> master-timeline unit
  highlight?: string; // beat: callout label (copied from step)
  card?: CardSpec; // card: what to render (copied from step)
}

export interface Manifest {
  runId: string;
  storyboard: StoryBoard;
  segments: Segment[];
  output?: string; // final mp4 path
  fps: number;
  width: number;
  height: number;
}
