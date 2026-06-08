// Remotion root. The composition's duration is data-driven from the manifest
// (sum of measured audio frames) — resolved via calculateMetadata before render,
// which Remotion requires up front.

import { Composition } from "remotion";
import type { Manifest } from "../types";
import { Showreel, totalFrames } from "./Showreel";

const FALLBACK: Manifest = {
  runId: "",
  storyboard: { app: {}, flows: [], prerequisites: { secrets: [] } },
  segments: [],
  fps: 30,
  width: 1920,
  height: 1080,
};

export function RemotionRoot() {
  return (
    <Composition
      id="showreel"
      component={Showreel}
      fps={30}
      width={1920}
      height={1080}
      durationInFrames={1}
      defaultProps={{ manifest: FALLBACK }}
      calculateMetadata={({ props }) => {
        const m = props.manifest;
        const fps = m.fps || 30;
        return {
          durationInFrames: Math.max(1, totalFrames(m, fps)),
          fps,
          width: m.width || 1280,
          height: m.height || 720,
        };
      }}
    />
  );
}
