// Capture stage (v1). Drives the storyboard against the resolved URL with
// Playwright at 1080p and produces, per segment:
//   action -> recorded interaction clip (+ ms offsets of the salient action),
//             post-interaction screenshot, visible DOM text, target bbox
//   beat   -> the focal element scrolled into view, a viewport screenshot, and
//             that element's bbox (viewport coords) for zoom-to-element + callout
//   card   -> no capture; the card spec is carried through for the render stage
// A step whose selector can't be resolved live becomes a `blocked` segment and
// is surfaced — never faked.
//
// Determinism: pinned 1920x1080 viewport, deviceScaleFactor 2 (retina stills),
// reduced-motion forced, web-first auto-waiting. Beats screenshot the VIEWPORT
// (not full page) so a beat's bbox and image share one coordinate space.

import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { join, relative } from "node:path";
import { type Browser, type Page, chromium } from "playwright";
import { DEVICE_SCALE_FACTOR, HEIGHT, WIDTH } from "./config.js";
import {
  ensureRunDirs,
  initManifest,
  loadStoryboard,
  newRunId,
  runDir,
  saveManifest,
} from "./manifest.js";
import type { Manifest, Segment, Step, StepAction } from "./types.js";

const SETTLE_MS = 500;
const STEP_TIMEOUT = 15000;

async function waitForReady(page: Page, waitFor?: string): Promise<void> {
  if (!waitFor) return;
  if (waitFor === "networkidle") {
    await page.waitForLoadState("networkidle", { timeout: STEP_TIMEOUT });
    return;
  }
  await page.locator(waitFor).first().waitFor({ state: "visible", timeout: STEP_TIMEOUT });
}

async function performOne(page: Page, a: StepAction): Promise<void> {
  const loc = a.selector ? page.locator(a.selector).first() : null;
  switch (a.type) {
    case "click":
      await loc!.click({ timeout: STEP_TIMEOUT });
      break;
    case "type":
      await loc!.fill(a.value ?? "", { timeout: STEP_TIMEOUT });
      break;
    case "select":
      await loc!.selectOption({ label: a.value ?? "" }, { timeout: STEP_TIMEOUT });
      break;
    case "hover":
      await loc!.hover({ timeout: STEP_TIMEOUT });
      break;
    case "navigate":
      await page.goto(a.value!, { waitUntil: "networkidle", timeout: STEP_TIMEOUT });
      break;
  }
}

// Setup actions that lead INTO a step (select a dropdown, type a prompt, navigate
// a view). Run before the step's salient action and replayed verbatim in pass B.
async function runPre(page: Page, step: Step): Promise<void> {
  for (const a of step.pre ?? []) await performOne(page, a);
}

async function performAction(page: Page, step: Step): Promise<void> {
  if (step.action) await performOne(page, step.action);
}

function findWebm(dir: string): string {
  const f = readdirSync(dir).find((n) => n.endsWith(".webm"));
  if (!f) throw new Error(`No .webm recorded in ${dir}`);
  return join(dir, f);
}

// Pass A: one driver context walks the whole flow, capturing stills/DOM/bbox.
async function driverPass(browser: Browser, m: Manifest, steps: Step[]): Promise<void> {
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const url = m.storyboard.app.url!;
  await page.goto(url, { waitUntil: "networkidle", timeout: STEP_TIMEOUT });

  for (const step of steps) {
    const seg = m.segments.find((s) => s.stepId === step.id)!;
    seg.highlight = step.highlight;
    seg.card = step.card;
    try {
      if (step.kind === "card") {
        seg.status = "captured"; // synthetic — rendered later, nothing to capture
        continue;
      }

      await runPre(page, step); // select/type/navigate that leads into this step

      if (step.kind === "action") {
        if (step.action?.selector) {
          const box = await page.locator(step.action.selector).first().boundingBox({ timeout: STEP_TIMEOUT });
          if (box) seg.capture.bbox = box;
        }
        await performAction(page, step);
        await waitForReady(page, step.waitFor);
        const framePath = join(runDir(m.runId), "frames", `${step.id}.png`);
        await page.screenshot({ path: framePath });
        seg.capture.postFrame = relative(runDir(m.runId), framePath);
      } else {
        // beat
        await waitForReady(page, step.waitFor);
        if (step.focus) {
          const loc = page.locator(step.focus).first();
          await loc.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT });
          await page.waitForTimeout(250); // let scroll settle before measuring/shooting
          const box = await loc.boundingBox({ timeout: STEP_TIMEOUT });
          if (box) seg.capture.bbox = box;
        }
        const framePath = join(runDir(m.runId), "frames", `${step.id}.png`);
        await page.screenshot({ path: framePath }); // viewport, not full page
        seg.capture.frame = relative(runDir(m.runId), framePath);
      }

      seg.capture.domText = (await page.locator("body").innerText()).trim().slice(0, 4000);
      seg.status = "captured";
    } catch (err) {
      seg.status = "blocked";
      seg.blockedReason = `driver pass: ${(err as Error).message.split("\n")[0]}`;
    }
  }
  await ctx.close();
}

// Pass B: per action step, isolated recording context. Replays prior steps, then
// records the action and the ms window it occupies within the clip.
async function recordAction(browser: Browser, m: Manifest, steps: Step[], idx: number): Promise<void> {
  const step = steps[idx];
  const seg = m.segments.find((s) => s.stepId === step.id)!;
  if (seg.status === "blocked") return;

  const vdir = join(runDir(m.runId), "video", step.id);
  mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    reducedMotion: "reduce",
    recordVideo: { dir: vdir, size: { width: WIDTH, height: HEIGHT } },
  });
  const page = await ctx.newPage();
  const url = m.storyboard.app.url!;
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: STEP_TIMEOUT });
    for (let j = 0; j < idx; j++) {
      await runPre(page, steps[j]); // replay setup (incl. a beat's navigation)
      if (steps[j].kind === "action") await performAction(page, steps[j]);
      await waitForReady(page, steps[j].waitFor);
    }
    await runPre(page, step); // this step's own setup — kept OUT of the timed window
    if (step.action?.selector) {
      await page.locator(step.action.selector).first().waitFor({ state: "visible", timeout: STEP_TIMEOUT });
    }
    const startMs = Date.now() - t0;
    await performAction(page, step);
    await waitForReady(page, step.waitFor);
    const endMs = Date.now() - t0;
    await page.waitForTimeout(SETTLE_MS);

    const video = page.video()!;
    await ctx.close();
    const webm = findWebm(vdir);
    const dest = join(vdir, `${step.id}.webm`);
    if (webm !== dest) renameSync(webm, dest);
    void video;

    seg.capture.video = relative(runDir(m.runId), dest);
    seg.capture.clip = { startMs, endMs, durationMs: Date.now() - t0 };
  } catch (err) {
    await ctx.close().catch(() => {});
    seg.status = "blocked";
    seg.blockedReason = `record pass: ${(err as Error).message.split("\n")[0]}`;
  }
}

async function main(): Promise<void> {
  const storyboard = loadStoryboard();
  if (!storyboard.app.url) throw new Error("storyboard.app.url is required (deployed URL).");
  const steps = storyboard.flows.flatMap((f) => f.steps);

  const runId = newRunId();
  ensureRunDirs(runId);
  const m = initManifest(runId, storyboard);

  console.log(`▶ capture run ${runId} → ${storyboard.app.url}  (${WIDTH}x${HEIGHT})`);
  const browser = await chromium.launch();
  try {
    await driverPass(browser, m, steps);
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].kind === "action") await recordAction(browser, m, steps, i);
    }
  } finally {
    await browser.close();
  }
  saveManifest(m);

  console.log(`\n── capture summary (runs/${runId}) ──`);
  for (const s of m.segments) summarize(s);
  const blocked = m.segments.filter((s) => s.status === "blocked");
  console.log(
    blocked.length
      ? `\n⚠ ${blocked.length} blocked step(s) — surfaced, not faked.`
      : `\n✓ all ${m.segments.length} segments captured.`,
  );
}

function summarize(s: Segment): void {
  const c = s.capture;
  const bits = [
    s.card && `card:${s.card.variant}`,
    c.frame && `frame=${c.frame}`,
    c.postFrame && `postFrame=${c.postFrame}`,
    c.video && `video`,
    c.clip && `action@${c.clip.startMs}-${c.clip.endMs}ms`,
    c.bbox && `bbox`,
    s.highlight && `“${s.highlight}”`,
  ].filter(Boolean);
  const mark = s.status === "blocked" ? "✗" : "✓";
  console.log(`  ${mark} ${s.stepId} [${s.kind}] ${s.status}` + (s.blockedReason ? ` — ${s.blockedReason}` : ""));
  if (bits.length) console.log(`      ${bits.join("  ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
