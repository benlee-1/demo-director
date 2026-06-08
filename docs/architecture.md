# Agent Orchestration — Architecture

High-level view of the deployed app the demo reel walks through.

```mermaid
flowchart LR
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
```

- **Front doors** — a React single-page dashboard (REST + WebSocket) and a Slack
  ingress endpoint (`POST /slack/events`, HMAC signature-verified) both feed the
  same engine.
- **Engine** — one Node.js service (`http.ts`) hosts the HTTP + WebSocket server,
  the `WorkflowRunner` that orchestrates agent-to-agent handoffs (and pauses for
  approval), and the pluggable `AgentRuntime` (demo mock, or a real OpenClaw
  subprocess in production). It streams live run events back to the UI.
- **Data** — SQLite (Node's built-in `node:sqlite`) persists agents, workflows,
  runs, and the full message trail.
