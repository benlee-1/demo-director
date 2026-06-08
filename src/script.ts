// Script stage. A programmatic Anthropic API call (TS SDK) grounds per-segment
// narration in each segment's screenshot + visible DOM text (vision). One call
// generates all segments together so the narration flows as one arc (intro ->
// steps -> outro). Structured outputs guarantee parseable {narration, seconds}.
//
// Audio is the master timeline, so narration is the unit that will set each
// segment's duration; targetSeconds here is only a pre-VO estimate. The human
// can edit narration in manifest.json before the VO stage.

import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { ANTHROPIC_MODEL } from "./config.js";
import { loadManifest, resolveRunId, runDir, saveManifest } from "./manifest.js";

const NarrationSchema = z.object({
  segments: z.array(
    z.object({
      stepId: z.string(),
      narration: z.string(),
      targetSeconds: z.number(),
    }),
  ),
});

function imageBlock(runId: string, rel: string): Anthropic.ImageBlockParam {
  const data = readFileSync(join(runDir(runId), rel)).toString("base64");
  return { type: "image", source: { type: "base64", media_type: "image/png", data } };
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Set it in the environment (e.g. .env) and retry.");
    process.exit(1);
  }

  const runId = resolveRunId();
  const m = loadManifest(runId);
  const sb = m.storyboard;
  const usable = m.segments.filter((s) => s.status !== "blocked");
  if (usable.length === 0) throw new Error("No usable segments — run capture first.");

  const steps = sb.flows.flatMap((f) => f.steps);
  const targetTotal = usable.reduce((t, s) => t + (steps.find((x) => x.id === s.stepId)?.seconds ?? 12), 0);

  // Build one grounded, ordered request: intro/outro + per-segment image+context.
  const content: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text:
        `You are writing the voiceover narration for a polished ~3 minute product demo video of "${sb.flows[0]?.title ?? "an app"}".\n` +
        `The video has ${usable.length} ordered segments. Write natural, spoken narration for EACH segment, in order, so they flow as one continuous script with a clear arc.\n` +
        (sb.intro ? `\nWHAT THE PRODUCT IS (grounding): "${sb.intro}"\n` : "") +
        `\nSegment kinds and how to write them:\n` +
        `- card/title (the opener): 2-4 sentences. Explain what the product IS and WHO it's for before any UI appears. Hook the viewer.\n` +
        `- card/diagram: 2-3 sentences walking the high-level architecture shown in the diagram image (front doors → engine → data); accessible, not jargon-heavy.\n` +
        `- card/outro: 1 short warm closing sentence.\n` +
        `- beat: 1-2 sentences about the highlighted element and why it matters.\n` +
        `- action: 1-2 sentences on the interaction's outcome, NOT the mechanics of clicking.\n` +
        `\nCRITICAL HONESTY RULES (this is a demo-mode deployment):\n` +
        `- The agent message bodies on screen are PLACEHOLDER ECHOES (e.g. "...processed: ..."), not real reasoning. ` +
        `NEVER quote them, read them, or imply the agents produced genuine analysis. Describe the ORCHESTRATION instead: ` +
        `who hands off to whom, that each step is recorded with an estimated cost, the conditional edges, the guardrails, the approval gate.\n` +
        `- The run completes effectively instantly — do NOT say things "stream in", "watch it unfold", or describe live motion that isn't on screen. ` +
        `Describe the produced artifact (the recorded handoff chain), not a temporal performance.\n` +
        `- Describe only what is actually on screen (use the screenshot/diagram + text); invent no features. Conversational and confident, not salesy. Never narrate the cursor.\n` +
        `\nLENGTH: the TTS voice speaks ~3 words/second. Each segment has a target length in seconds (below); ` +
        `write roughly target_seconds × 3 words for it, and set targetSeconds to your word count divided by 3. ` +
        `Total should land near ${targetTotal} seconds (~${Math.round(targetTotal * 3)} words). Reach length with genuine DEPTH ` +
        `(what guardrails do, why approval gates matter, what a conditional edge is) — never padding or repetition.`,
    },
  ];

  for (const seg of usable) {
    const step = steps.find((s) => s.id === seg.stepId)!;
    const frame = seg.capture.frame ?? seg.capture.postFrame;
    const cardInfo = seg.card
      ? `card variant: ${seg.card.variant}` +
        (seg.card.title ? `; title: "${seg.card.title}"` : "") +
        (seg.card.subtitle ? `; subtitle: "${seg.card.subtitle}"` : "") +
        (seg.card.body ? `; body: "${seg.card.body}"` : "")
      : "";
    content.push({
      type: "text",
      text:
        `\n--- Segment ${seg.stepId} (${seg.kind}) — target ~${step.seconds ?? 12}s ---\n` +
        `intent: ${step.intent}\n` +
        (seg.highlight ? `highlighted element: "${seg.highlight}"\n` : "") +
        (cardInfo ? `${cardInfo}\n` : "") +
        (seg.capture.domText ? `on-screen text (excerpt): ${seg.capture.domText.slice(0, 800)}` : ""),
    });
    if (frame) content.push(imageBlock(runId, frame));
  }

  console.log(`▶ script: generating narration for ${usable.length} segments (${ANTHROPIC_MODEL})`);
  const client = new Anthropic();
  const res = await client.messages.parse({
    model: ANTHROPIC_MODEL,
    max_tokens: 8000,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(NarrationSchema) },
  });

  const out = res.parsed_output;
  if (!out) throw new Error(`Script generation failed to parse (stop_reason=${res.stop_reason}).`);

  const byId = new Map(out.segments.map((s) => [s.stepId, s]));
  for (const seg of m.segments) {
    const g = byId.get(seg.stepId);
    if (g) {
      seg.narration = g.narration.trim();
      seg.targetSeconds = g.targetSeconds;
    }
  }
  saveManifest(m);

  console.log(`\n── narration (runs/${runId}) ──`);
  for (const seg of m.segments) {
    if (seg.narration) {
      console.log(`\n  ${seg.stepId} [${seg.kind}] ~${seg.targetSeconds}s`);
      console.log(`  “${seg.narration}”`);
    } else if (seg.status !== "blocked") {
      console.log(`\n  ${seg.stepId} — ⚠ no narration returned`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
