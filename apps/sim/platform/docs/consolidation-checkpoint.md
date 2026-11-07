# Platform and EMCN consolidation — 2026-11-06

Both implementation tracks are consolidated in the main checkout on `improvement/platform-preview`. They shared a working tree; no older Platform branch was merged. The consolidation commit follows `cf841e50d98c9eb04ab8d5c985ceda75224258c3`. Use the commit containing this checkpoint as the local handoff revision.

The single fixture preview remains at `http://localhost:3125/home?state=full`. Reuse its running process. This iteration is local; it has not been pushed or published.

## Reconciliation with `improvement/platform-core-chat`

The branch was reconciled with `origin/improvement/platform-core-chat` at `d375b0ca2d` in two merges, so each can be reviewed and shipped on its own:

1. **Merge A** (`5dad61689e`) brings the integration-center work (`cf841e50d9`, before the package split) onto the latest organization wiring: the `embedded/` and `shared/` trees, chat steering and multi-account Search. It fast-forwards PR #9725.
2. **Merge B** brings the EMCN package split (`b5a30e9744`) onto Merge A. It moves `platform/design-system` into `packages/emcn` and `packages/emcn-platform`, so `embedded/`, `shared/` and `app/o` now import package subpaths, and `@sim/emcn` names the modern package everywhere.

Decisions in Merge B for the `embedded/` owner to review:

- Embedded `Select variant='quiet'` controls became `ChoiceMenu`, and quiet `MultiSelect` / `SearchableSelect` became `variant='text'`, following the zone. The pickers keep no `quiet` variant and `Select` has no `block`.
- Embedded `ActivityRow` callers use `textMetadata`, which pairs with `people`. `DataTable` columns take `share` for a percentage share of the table; `width` keeps the zone's `compact` / `regular` sizing.
- `Hydrated` moved to `app/o/[organizationId]/components/hydrated.tsx`: React Query hydration belongs to the host, not a UI package.
- `host-bridge.module.css` lives in `packages/emcn-platform/src/styles/` and names the `EMCN Geist` family. An embedded surface paints its canvas only with `canvas`, through `[data-embedded]:not([data-canvas])`; the zone keeps painting by default.
- `embedded/` may import only itself, `platform/shared` and the EMCN packages (`check:platform-design`, `check:boundaries` rule 7). `check:platform-css` reads the host bridge from its package.

## Canonical owners

| Owner | Responsibility |
| --- | --- |
| `packages/emcn` | Shared controls, typography, icons, fonts, tokens and interaction recipes |
| `packages/emcn-platform` | Platform page, chat and workspace compositions |
| `packages/emcn-auth` | Auth shells and consent compositions |
| `packages/emcn-docs` | Documentation content and reference compositions |
| `packages/emcn-legacy` | Existing application compatibility, excluded from modern component dependencies |
| `apps/sim/platform` | Routes, fixtures, data adapters and feature-specific compositions |

The [design contract](../AGENTS.md), [component ownership map](component-ownership.md), [integration guide](integration-center.md) and [EMCN guide](../../../../packages/emcn/README.md) describe the maintained interfaces. Consumer imports, generators, audit rules, CI and the lockfile were migrated together with their owners. The existing application retains its legacy components. No database migration or new public API was introduced.

## Completed work

- Consolidated rows, fields, search, stacks, counts, modal form items, tabs, table controls and page geometry. Shared owners now supply the same recipes to product consumers.
- Reworked integration, credential, Skill and MCP details; nested filters and origin-aware navigation; private fixture enrollment and sharing; provider-specific methods and manual secrets. Existing live-adapter authority remains unchanged.
- Aligned people identities, table columns and responsive wrapping. Selection preserves table position, with caller-owned actions and protected-administrator rules.
- Unified destructive confirmation triggers, permanent read-only copy actions and neutral disabled paint. Optional disabled reasons remain accessible through pointer, keyboard and touch without enabling controls.
- Corrected picker label dismissal so closing a popup does not reopen it. Consolidated available-only usage sentences, maker identity and artwork prompt handoff.
- Migrated Auth and Docs to modern foundations, including consent spacing, Docs popup containment and shared desktop font assets.

## Verification evidence

The latest complete repository gate ran against the combined working tree before this documentation-only consolidation. The 764-file Platform/shared-source manifest was checked again before committing: every recorded file was unchanged. Its SHA-256 is `6823b8179a49de970c29d1c2547ec37975db6db2b3bb7a88f94191c64175046d`.

| Check | Result |
| --- | --- |
| Repository lint | 30/30 tasks passed; no fixes applied |
| Repository types | 32/32 tasks passed |
| Repository audits | 67/67 passed |
| Complete repository tests | 20/20 tasks passed; app: 39,617 passed, 8 existing skips |
| Platform production build | Passed |
| Block registry validation | Passed against `origin/staging` |
| Platform browser review | 114 distinct checks resolved across the full run and recorded follow-ups |
| Latest disabled-control regression | 10 checks passed, both themes, 390/901/1440px, enlarged text, pointer, keyboard and touch |
| Independent disabled-control review | Four real-touch cases passed; negative control failed before the fix |
| Latest actual Electron review | Four protected-person cases passed in both themes |
| Independent consolidation inventory | No unexplained files, credentials, build output or unrelated backend implementation changes |

The earlier incomplete Node runs are superseded by the complete green repository test gate. Use the compatible Node 24 / isolated-vm environment recorded in the local artifacts for this checkout; the final gate used `bun run test --concurrency=1 -- --maxWorkers=4`.

EMCN's earlier surface evidence also includes Auth 14/14, Docs 93/93 plus the 3,000-document corpus, production Platform 106/106 including fixture-off, and desktop checks. These remain dated evidence: later Platform refinements were verified by the subsequent browser, Electron and repository gates above.

## Local artifacts and next shipping step

The task artifact roots are under `~/.codex/visualizations/2026/11/06/`:

- `01a1af05-5810-7d93-b749-04d3e5c2a37e/platform-consistency/`: source manifest, browser reports, screenshots, traces and independent/Electron evidence.
- `01a1af05-5810-7d93-b749-04d3e5c2a37e/disabled-selection/`: latest gate logs and focused browser report.
- `01a1af05-5810-7d93-b749-04d3e5c2a37e/combined-consolidation/`: recovery diff/archive, complete working-tree manifest and final commit checkpoint.
- `01a1b257-6518-73b1-963e-84d37505b8f1/emcn-consolidation/`: migration recovery snapshot and Auth/Docs/desktop evidence.

Implementation and local consolidation are complete. Before a separately authorized shipping step, run production-runtime and fixture-off checks against the chosen shipping commit and record their exact revision. Earlier production evidence is not an exact-commit release sign-off. Preserve the single preview while arranging those checks; no additional server was started for this consolidation.
