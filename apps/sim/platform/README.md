# Sim Platform

The Platform is the product's organization and workspace surface. The main app serves it from the `app/(product)/` route group: organization pages under `app/(product)/o/[organizationId]/`, workspace pages under `app/(product)/workspace/[workspaceId]/`. This folder holds what those routes share: the [data seam](AGENTS.md#data-seam) in `lib/`, pure helpers in `shared/`, example data in `fixtures/`, the bootstrap stylesheet in `styles/` and the browser checks in `checks/`.

The rules live in the [Platform design contract](AGENTS.md), and the [component ownership map](docs/component-ownership.md) says which component owns what. To build or change a page, use the [`implement-platform` skill](../../../.agents/skills/implement-platform/SKILL.md). Feature notes: [integration center](docs/integration-center.md), [workspace UI](docs/workspace-ui.md), [organization parity ledger](docs/org-parity.md).

## Run it

From the repository root:

```sh
bun run --cwd apps/sim dev                             # live data: sign in as a real user
SIM_PLATFORM_FIXTURES=1 bun run --cwd apps/sim dev     # fixture data: no sign-in
```

The fixture switch is read when the app compiles, so restart the server to change modes; a normal build always serves live data. Fixture pages live under the organization `sim`: [Home](http://localhost:3000/o/sim/home), [Chat](http://localhost:3000/o/sim/chat/weekly-review?state=full), [Settings](http://localhost:3000/o/sim/settings), [Integrations](http://localhost:3000/o/sim/integrations?state=full) and a workspace's [Dashboard](http://localhost:3000/workspace/it/dashboards?state=full). Add `?state=empty` or `?state=stress` for the empty and stress scenarios; Settings billing also takes `plan=team` or `plan=free`.

### In Sim Desktop

Start the app as above, then launch the desktop shell against it with a disposable profile:

```sh
SIM_DESKTOP_ORIGIN=http://localhost:3000 SIM_DESKTOP_USER_DATA="$(mktemp -d)" bun run --cwd apps/desktop dev
```

## Regenerate generated sources

| Source changed | Command |
| --- | --- |
| Paper Shared tokens and type masters | `bun scripts/sync-platform-foundations.ts <tokens.json> <registry.json> <styles.json>` (`--check` compares without writing) |
| Paper Shared/Platform master anatomy | `bun scripts/sync-platform-recipes.ts <paper-references-directory> <exports-directory>` |
| Provider metadata, connection definitions, skills, templates or registry icons | `bun scripts/sync-platform-integration-metadata.ts` (`bun run check:platform-integration-metadata` checks) |
| The permission-group editor's catalog | `bun scripts/sync-platform-permission-catalog.ts` (`bun run check:platform-permission-catalog` checks) |

Keep raw Paper exports local: they may hold private example content.

## Verify

```sh
bun run check:platform-design
bun run check:platform-css
bun run check:emcn-surface
bun run check:boundaries
bun run check:platform-parity
bun run --cwd apps/sim type-check
bunx --no-install playwright install chromium
SIM_PLATFORM_FIXTURES=1 bun run --cwd apps/sim build
bun run --cwd apps/sim test:platform:e2e
# On macOS, also exercise the real shell and preload:
bun run --cwd apps/desktop build
bun run --cwd apps/sim test:platform:desktop
```

The fixture suites serve that fixture production build with `next start` on their own ports; set `PLATFORM_E2E_ORIGIN` to run them against a fixture server you already started. `bun run --cwd apps/sim test:platform:live` runs `checks/live/` against a production build and database you started (`PLATFORM_LIVE_ORIGIN`, plus the accounts `checks/live/session.ts` reads); `.github/scripts/http-e2e.sh platform-live` boots that stack the way CI does, and `PLATFORM_LIVE_REPORT_PATH` saves its JSON report.
