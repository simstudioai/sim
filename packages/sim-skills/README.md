# sim-skills

Official skills-only `sim` plugin for building workflows and operating Sim resources through the
Sim CLI. The same skills can also be installed directly with the standard Agent Skills installer.

## Install

Run the interactive installer:

```bash
bunx sim-skills
```

Install one skill globally for a specific agent:

```bash
bunx sim-skills --skill build-workflow --agent codex --global --yes
```

List the bundled skills without installing them:

```bash
bunx sim-skills --list
```

All options after `sim-skills` are forwarded to the standard Agent Skills installer. `install` and
`add` are optional aliases, so `bunx sim-skills install --list` is equivalent to the last example.

For native plugin development, point the host at the `sim/` directory. The manifests in
`.codex-plugin/` and `.claude-plugin/` both declare `sim` as the plugin namespace.

## Namespace

Native plugin installs expose the skills under the `sim` namespace:

- `sim:build-workflow`
- `sim:run-workflow`
- `sim:deploy-workflow`
- `sim:table`
- `sim:knowledge-base`

Direct installs through `bunx sim-skills` install the selected skills without the plugin prefix.

## Included skills

- `build-workflow` — discover blocks and author a draft graph with atomic workflow operations.
- `run-workflow` — test saved state, exercise triggers, resume from a block, and diagnose runs.
- `deploy-workflow` — publish and manage workflows as APIs, chats, or MCP tools.
- `table` — design typed tables, load and query rows, import data, and run workflow groups.
- `knowledge-base` — ingest and index documents, configure connectors and tags, and verify retrieval.

The skills assume the `sim` CLI is installed and authenticated. They never store or print API keys.
