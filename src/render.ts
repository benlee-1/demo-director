// Render stage. Bundles the Remotion composition with the run directory as the
// public dir (so staticFile() resolves the captured frames/clips/audio), injects
// each displayed still's pixel size for the Ken Burns math, then renders to mp4.
// ffmpeg runs underneath @remotion/renderer for encode/mux.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { OUT_DIR } from "./config.js";
import { loadManifest, resolveRunId, runDir } from "./manifest.js";
import type { Manifest } from "./types.js";

// PNG IHDR carries width/height as big-endian uint32 at byte offsets 16 and 20.
function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function withFrameSizes(m: Manifest): Manifest {
  for (const seg of m.segments) {
    const still = seg.capture.frame ?? seg.capture.postFrame;
    if (still) {
      try {
        seg.capture.frameSize = pngSize(join(runDir(m.runId), still));
      } catch {
        /* leave undefined; component falls back to comp size */
      }
    }
  }
  return m;
}

async function main(): Promise<void> {
  const runId = resolveRunId();
  const manifest = withFrameSizes(loadManifest(runId));
  if (!manifest.segments.some((s) => s.audio)) {
    throw new Error("No segments have audio — run the VO stage before rendering.");
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const outputLocation = join(OUT_DIR, "showreel.mp4");

  console.log(`▶ render run ${runId}: bundling…`);
  const serveUrl = await bundle({
    entryPoint: resolve("src/remotion/index.ts"),
    publicDir: resolve(runDir(runId)),
  });

  const inputProps = { manifest };
  const composition = await selectComposition({ serveUrl, id: "showreel", inputProps });
  console.log(
    `▶ render: ${composition.durationInFrames} frames @ ${composition.fps}fps ` +
      `(${(composition.durationInFrames / composition.fps).toFixed(1)}s), ${composition.width}x${composition.height}`,
  );

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    crf: 18, // higher quality encode
    outputLocation,
    inputProps,
    onProgress: ({ progress }) => {
      process.stdout.write(`\r  rendering ${Math.round(progress * 100)}%   `);
    },
  });

  console.log(`\n✓ rendered → ${outputLocation}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
