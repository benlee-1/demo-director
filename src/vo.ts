// Voiceover stage. For each segment with narration, synthesize an mp3 via the
// TtsProvider and record its MEASURED duration into manifest.audio. These
// measured seconds ARE the master timeline the compose stage paces visuals to.

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { VOICE_ID } from "./config.js";
import { loadManifest, resolveRunId, runDir, saveManifest } from "./manifest.js";
import { ElevenLabsProvider } from "./tts/elevenlabs.js";

async function main(): Promise<void> {
  // Construct the provider first — it throws a clear message if the key is unset,
  // before we do any work.
  const tts = new ElevenLabsProvider();

  const runId = resolveRunId();
  const m = loadManifest(runId);
  const todo = m.segments.filter((s) => s.status !== "blocked" && s.narration);
  if (todo.length === 0) throw new Error("No narrated segments — run the script stage first.");

  console.log(`▶ vo: synthesizing ${todo.length} clips with ${tts.name} (voice ${VOICE_ID})`);
  for (const seg of todo) {
    const { audio, seconds } = await tts.synthesize(seg.narration!, { voiceId: VOICE_ID });
    const rel = join("audio", `${seg.stepId}.mp3`);
    writeFileSync(join(runDir(runId), rel), audio);
    seg.audio = { path: rel, seconds };
    console.log(`  ✓ ${seg.stepId}  ${seconds.toFixed(2)}s  (${(audio.length / 1024).toFixed(0)} KB)`);
  }
  saveManifest(m);

  const total = todo.reduce((t, s) => t + (s.audio?.seconds ?? 0), 0);
  console.log(`\n✓ master timeline = ${total.toFixed(2)}s across ${todo.length} segments → runs/${runId}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
