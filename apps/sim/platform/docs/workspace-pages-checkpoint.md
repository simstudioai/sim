# Workspace pages — 2026-11-07

Dashboard, Issues, Changelog and Logs are Platform pages under `app/(shell)/workspace/[workspaceId]/`, on `improvement/platform-core-chat` after `2df4be8bb2`. The work is local and unpushed. Review it at `http://localhost:3125/workspace/it/dashboards?state=full`, served from the main checkout; `?state=stress` holds the extremes and `?state=empty` every empty state.

## What landed

| Commit | Change |
| --- | --- |
| `refactor(platform): promote the integration controls…` | `IntegrationControls` became `(shell)/_components/control-bar` `ControlBar`; Integrations imports it. |
| `refine(emcn): match chart headers and metric values to Home` | Chart header controls add no height; `MetricGroup` values use T076. Settings usage and the Platform overview share both. |
| `feat(platform): give workspaces their own Platform pages` | Routes, navigation (Issues added, hidden on live), shell behavior, the tab frame, the detail split, the fixture session and one server-gated fixture module. |
| `feat(platform): build the workspace dashboard` | Metrics, trend, stacked, grouped and signed bars, donut, text, roster and typed table; period in the URL, section-local choices. |
| `feat(platform): add workspace issues and their details` | Grouped list with search, status and sort; details with document change, workspace changes, comparison, impact, source, evidence and history; decisions in the control bar. |
| `feat(platform): add the workspace changelog and change details` | Feed by day with contributor and issue link; details beside the facts. |
| `feat(platform): add workspace logs and run details` | Runs with filters, sort and new runs; the trace on one clock, the step inspector and payloads. |
| `refine(platform): keep a workspace list's place and report its read` | Reading position on Back, Forward and the Back link; pending and failure reads. |
| `test(platform): check the workspace pages in the browser` | `checks/workspace-pages.spec.ts`. |
| `docs(platform): describe the workspace pages and their owners` | `workspace-ui.md`, `component-ownership.md`, `org-parity.md`, the contract pointer. |
| `refine(emcn): equal metric columns, six donut colors, contained legends` | MetricGroup pairs four metrics when narrow and uses Home's column gap; donuts past four segments stay distinct; long legend names wrap. |
| `fix(platform): address the workspace pages review` | The independent review's findings: groups and reading position on Back, duration and tick rounding, stale filter values, accessible run rows, ID lane, model units, grouped bar legend. |

## Decisions to review

- Paper could not be read in this session (no Paper MCP), so the pages follow the contract JSONs and the brief. Compare Paper's Workspace shell for the tab order and labels, which follow the brief: Dashboard, Issues, Changelog, Logs.
- Workspace tabs scroll as one page in the shell's scroller, at least the viewport tall so empty states center beneath the controls. Record details are bounded panes where only the reading column scrolls.
- Group headers use EMCN `Disclosure` (`navigation` variant, so a collapsed group keeps the text edge). Its caption type differs from Integrations' T059 group titles; changing either is the owner's call.
- Grouped and signed bars are local to Dashboard: one consumer each, so no EMCN variant. Trend, stacked bars and donut use the EMCN charts.
- Changelog details show WorkspaceChanges in the reading column, as the brief says, rather than in the rail, as Paper's desktop specimen does.
- The empty fixture scenario borrows the full scenario's workspaces for these pages only, so every empty state has a URL; the sidebar still lists none.
- Stale issues sit in Needs review; queued, blocked and failed sit in In progress. A row names its state after the title where the group does not.

## Verification

| Check | Result |
| --- | --- |
| `type-check:platform` | Passed |
| `check:audits` | 68/68, including `check:platform-design`, `check:platform-css`, `check:platform-convergence` and `check:unused-exports` |
| `checks/workspace-pages.spec.ts` on :3125 | 10/10, twice in a row on the final commit |
| Full Platform suite on :3125 | 118 of 124 on the first run. The six failures came while files were being edited under hot reload; their specs (credential access, integration center, integrations, manual credentials, platform) pass on a clean rerun |
| Visual review | Every route at 390, 901 and 1440 in light and dark on `full`, and at 390 and 1440 on `stress`, compared with Home and Integrations. Heading, tabs, search and sort sit at the same coordinates as Integrations (heading 326/64, tabs 326/145, search 348/192, sort 1374/188 at 1440) |
| Independent review | A fresh agent reviewed the owners and routes against the brief; its correctness and robustness findings are fixed in `fix(platform): address the workspace pages review` |

Not run: `build:platform` (it would write into the shared preview's `.next`), the Electron suite, and the fixture-off production suite.

## Open items

- Live adapters: Dashboard over `hooks/queries/dashboards.ts`, Changelog over `hooks/queries/changelog.ts`, Logs over `hooks/queries/logs.ts`, each mapped onto the existing view props and `WorkspaceRead`. Issues needs a backend first.
- Per-section dashboard failures with a stale timestamp (Paper's error state) are not modeled; a failed read replaces the whole tab's content.
- Desktop (Electron) verification and a production build of the new pages have not been run.
- The brief's reading order puts the comparison with the proposed change and the source excerpt with the evidence; confirm that grouping with product.
- Issues' Created column shows relative ages, which the time contract allows; the brief's day-label rule applies to day headings. Confirm with product.
- Home's chart axis uses T034 while the EMCN charts use T050 for the same role; that predates this work.
