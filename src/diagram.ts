// Architecture diagram stage. Writes the Agent Orchestration architecture as a
// mermaid file (deliverable) and renders it to a PNG via Playwright + the mermaid
// CDN (reusing the browser we already have — no new dependency), themed to match
// the reel's cards, then patches the manifest's diagram card to display it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { loadManifest, resolveRunId, runDir, saveManifest } from "./manifest.js";

const MERMAID = `flowchart LR
  Slack([Slack]):::ext -->|"@mention · signed"| Server
  User([Web UI]):::user -->|"REST + WebSocket"| Server

  subgraph Node["Node.js service · Railway"]
    Server["HTTP + WebSocket<br/>http.ts"]:::node
    Runner["WorkflowRunner<br/>orchestrates handoffs"]:::node
    Runtime["AgentRuntime<br/>demo · or OpenClaw"]:::node
    DB[("SQLite<br/>agents · workflows · runs · messages")]:::store
  end

  Server --> Runner
  Runner -->|"run each node"| Runtime
  Runner -->|"persist"| DB
  Runner -.->|"live events"| User

  classDef user fill:#1f322e,stroke:#f0b65b,color:#f8f3e7,stroke-width:2px;
  classDef ext fill:#1f322e,stroke:#d95f36,color:#f8f3e7,stroke-width:2px;
  classDef node fill:#1f322e,stroke:#d95f36,color:#f8f3e7,stroke-width:2px;
  classDef store fill:#2d443f,stroke:#f0b65b,color:#f8f3e7,stroke-width:2px;
`;

const MD = `# Agent Orchestration — Architecture

High-level view of the deployed app the demo reel walks through.

\`\`\`mermaid
${MERMAID}\`\`\`

- **Front doors** — a React single-page dashboard (REST + WebSocket) and a Slack
  ingress endpoint (\`POST /slack/events\`, HMAC signature-verified) both feed the
  same engine.
- **Engine** — one Node.js service (\`http.ts\`) hosts the HTTP + WebSocket server,
  the \`WorkflowRunner\` that orchestrates agent-to-agent handoffs (and pauses for
  approval), and the pluggable \`AgentRuntime\` (demo mock, or a real OpenClaw
  subprocess in production). It streams live run events back to the UI.
- **Data** — SQLite (Node's built-in \`node:sqlite\`) persists agents, workflows,
  runs, and the full message trail.
`;

function htmlFor(graph: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  html,body{margin:0;background:#14201d;}
  #wrap{width:1600px;padding:64px;box-sizing:border-box;background:#14201d;}
  .mermaid{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}
  .cluster rect{rx:14px;ry:14px;}
</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head><body>
<div id="wrap"><pre class="mermaid">${graph}</pre></div>
<script>
  mermaid.initialize({ startOnLoad:true, theme:"base", securityLevel:"loose",
    themeVariables:{ fontSize:"26px",
      clusterBkg:"#101a17", clusterBorder:"#3d5852",
      lineColor:"#d95f36", primaryColor:"#1f322e", primaryTextColor:"#f8f3e7",
      primaryBorderColor:"#d95f36" }});
</script>
</body></html>`;
}

async function main(): Promise<void> {
  const runId = resolveRunId();
  const m = loadManifest(runId);

  // 1. Deliverable file.
  mkdirSync("docs", { recursive: true });
  writeFileSync("docs/architecture.md", MD);
  console.log("✓ wrote docs/architecture.md");

  // 2. Render PNG via Playwright.
  const cardsDir = join(runDir(runId), "cards");
  mkdirSync(cardsDir, { recursive: true });
  const out = join(cardsDir, "arch.png");

  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.setContent(htmlFor(MERMAID), { waitUntil: "networkidle" });
  const svg = page.locator(".mermaid svg");
  await svg.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(300);
  await page.locator("#wrap").screenshot({ path: out });
  await browser.close();
  console.log(`✓ rendered ${out}`);

  // 3. Patch the diagram card to display it.
  const b = readFileSync(out);
  const card = m.segments.find((s) => s.card?.variant === "diagram");
  if (card) {
    card.capture.frame = "cards/arch.png";
    card.capture.frameSize = { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (card.card) card.card.image = "cards/arch.png";
    saveManifest(m);
    console.log(`✓ patched diagram card (${card.stepId}) → cards/arch.png`);
  } else {
    console.log("⚠ no diagram card in manifest to patch");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
