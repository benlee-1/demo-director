// Manifest I/O — the manifest threads Segment[] through every pipeline stage and
// lives at runs/<runId>/manifest.json. A runs/.latest pointer records the most
// recent run so each stage can find it without an explicit --run argument.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FPS, HEIGHT, RUNS_DIR, WIDTH } from "./config.js";
import type { Manifest, StoryBoard } from "./types.js";

export function loadStoryboard(path = "storyboard.json"): StoryBoard {
  return JSON.parse(readFileSync(path, "utf8")) as StoryBoard;
}

export function newRunId(): string {
  // Sortable, filesystem-safe timestamp id.
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes(),
  )}${p(d.getSeconds())}`;
}

export function runDir(runId: string): string {
  return join(RUNS_DIR, runId);
}

export function ensureRunDirs(runId: string): void {
  for (const sub of ["", "frames", "video", "audio"]) {
    mkdirSync(join(runDir(runId), sub), { recursive: true });
  }
}

export function initManifest(runId: string, storyboard: StoryBoard): Manifest {
  const segments = storyboard.flows.flatMap((flow) =>
    flow.steps.map((step) => ({
      stepId: step.id,
      kind: step.kind,
      status: "pending" as const,
      capture: {},
    })),
  );
  return { runId, storyboard, segments, fps: FPS, width: WIDTH, height: HEIGHT };
}

export function manifestPath(runId: string): string {
  return join(runDir(runId), "manifest.json");
}

export function saveManifest(m: Manifest): void {
  writeFileSync(manifestPath(m.runId), JSON.stringify(m, null, 2));
  writeFileSync(join(RUNS_DIR, ".latest"), m.runId);
}

export function latestRunId(): string {
  const pointer = join(RUNS_DIR, ".latest");
  if (existsSync(pointer)) return readFileSync(pointer, "utf8").trim();
  // Fallback: newest run dir by name (ids are sortable).
  const ids = readdirSync(RUNS_DIR).filter((n) => !n.startsWith("."));
  if (ids.length === 0) throw new Error("No runs found. Run the capture stage first.");
  return ids.sort().at(-1)!;
}

// Resolve the run to operate on: explicit `--run <id>` arg, else the latest.
export function resolveRunId(argv = process.argv.slice(2)): string {
  const i = argv.indexOf("--run");
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  return latestRunId();
}

export function loadManifest(runId: string): Manifest {
  return JSON.parse(readFileSync(manifestPath(runId), "utf8")) as Manifest;
}

// Re-export so stages can import shapes from one place if convenient.
export type { Manifest, StoryBoard };
export { FPS, WIDTH, HEIGHT };
