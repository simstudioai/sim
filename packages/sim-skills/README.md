# sim-skills

Official Agent Skills for building workflows and operating Sim resources through the Sim CLI.

## Install

Run the interactive installer:

```bash
bunx sim-skills
```

Install one skill globally for a specific agent:

```bash
bunx sim-skills --skill build-sim-workflow --agent codex --global --yes
```

List the bundled skills without installing them:

```bash
bunx sim-skills --list
```

All options after `sim-skills` are forwarded to the standard Agent Skills installer. `install` and
`add` are optional aliases, so `bunx sim-skills install --list` is equivalent to the last example.

## Included skills

- `build-sim-workflow` — discover blocks and author a draft graph with atomic workflow operations.
- `run-sim-workflow` — test saved state, exercise triggers, resume from a block, and diagnose runs.
- `deploy-sim-workflow` — publish and manage workflows as APIs, chats, or MCP tools.
- `sim-table` — design typed tables, load and query rows, import data, and run workflow groups.
- `sim-knowledge-base` — ingest and index documents, configure connectors and tags, and verify retrieval.

The skills assume the `sim` CLI is installed and authenticated. They never store or print API keys.
