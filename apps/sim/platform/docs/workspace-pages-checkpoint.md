# Workspace pages — 2026-11-07

Dashboard, Issues, Changelog and Logs are Platform pages under `app/(shell)/workspace/[workspaceId]/`, on `improvement/platform-core-chat` after `2df4be8bb2`. The work is local and unpushed. A workspace opens beside the organization sidebar; these four pages and their details are the workspace's only pages. Review it at `http://localhost:3125/workspace/it/dashboards?state=full`, served from the main checkout; `?state=stress` holds the extremes and `?state=empty` every empty state.

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
| `refactor(platform): open workspaces beside the organization sidebar` | A workspace row opens its Dashboard and is marked current; the sidebar no longer switches into a workspace mode. Workspace chat, skills, the integrations redirect, the resource and workflow pages and the Vite iframe preview are deleted, with fixture workspace chats, the Disclosure folder variant and the skill directory helpers. |
| `test(platform): keep the organization sidebar on workspace pages` | The sidebar keeps Home, Integrations and Workspaces across a workspace, its tabs and a switch to another workspace. Reverting either guard (the hidden main navigation, the current row) turns it red. |
| `refine(emcn): keep chart header controls inside the chart edge` | A chart's header control ends at its edge with the text inset, as Home's period does. |
| `refine(platform): keep workspace controls inside the column and follow Paper's rows` | The control bar no longer overhangs the column; issue groups and rows follow Integrations and Paper's IssueRow with a right-aligned date; log rows follow Paper's RunRow with data on the right. |
| `feat(platform): show a run's selected step beside its trace` | DetailSplit's ticket bar and inspector rail; run facts as Paper's metadata fields; the selected step's input and output in the inspector; records use DirectoryHeading and T093 sections. |
| `refactor(platform): render the dashboard table on EMCN DataTable` | The dashboard table adapts to DataTable, Paper's named owner. |
| `fix(platform): address the workspace sidebar review` | ControlBar takes search in its own slot; stress chat-panel recents point at stress workspaces; two stale doc sentences. |
| `refine(platform): align workspace controls, rows and type with Home and Integrations` | Only search fills the control bar's leading slot; issue rows center and the Created label meets its values; changelog entries take ActivityRow's roles; decisions use the secondary Button; OverflowText labels keep their parent's role, so logs and chart ticks read at regular weight. |

## Decisions to review

- Paper could not be read in this session (no Paper MCP), so the pages follow the contract JSONs and the brief. Compare Paper's Workspace shell for the tab order and labels, which follow the brief: Dashboard, Issues, Changelog, Logs.
- A live workspace row still opens the legacy workspace (`legacyRoutes.workspace`), since no live adapter feeds these pages yet. Fixture rows open Dashboard.
- `ShellWorkspace.workflows` stays: the composer's @-references list each workspace's workflows. Changed items without a page (workflows, tables, knowledge bases, files) are passive rows; the external Notion page still links.
- Issue rows center their text against a wrapped title, as DataTable cells do, so a two-line title's ID and age sit at its middle.
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
| Sidebar and design follow-up | `type-check:platform`, `check:platform-design`, `check:platform-css`, `check:platform-convergence` and `check:unused-exports` pass. `workspace-pages`, `shell`, `panels`, `integration-center`, `integrations` and `controls-consistency` pass on :3125. Before and after screenshots at 1440 and 390 in light, and 1440 in dark. At 125% text the control bar stays inside the text edges at 1440, 901 and 390. Repo gate: `lint:check`, `check:audits` (68), `test:scripts` (845) and `type-check` (32 workspaces) pass. Full Platform suite 121 of 123; both failures came from the preview's worker restarting and pass on rerun. The Electron renderer check passes against :3125, and a scratch Electron run opened a workspace, a run and the sidebar toggle with the sidebar unchanged and the workspace name in the native titlebar. An independent review found no blocking issue; its findings are fixed in `fix(platform): address the workspace sidebar review` |

Not run: `build:platform` (it would write into the shared preview's `.next`), the Electron suite, and the fixture-off production suite.

## Open items

- Paper's full log-details artboard is not in the repository; its recipes (TraceRow, TracePayload, MetadataField, TicketControlBar, RunRow) and your direction set the layout. The changelog keeps the smaller entry type you asked for over Paper's T093 ChangeEntry title.
- The shared preview on :3125 restarts its worker whenever it nears Next's memory threshold (`/private/tmp/sim-platform-shared-preview.log` records dozens). Each restart refuses connections briefly and recompiles pages on first visit, which makes frame-level browser checks such as the Back restore intermittently fail. The agent restarted it in place on 2026-11-08 (same checkout, port, Node, heap, fixture flag and log); on the fresh server the workspace checks pass 11 of 11 and the Back restore 5 of 5.

- Live adapters: Dashboard over `hooks/queries/dashboards.ts`, Changelog over `hooks/queries/changelog.ts`, Logs over `hooks/queries/logs.ts`, each mapped onto the existing view props and `WorkspaceRead`. Issues needs a backend first.
- Per-section dashboard failures with a stale timestamp (Paper's error state) are not modeled; a failed read replaces the whole tab's content.
- Desktop (Electron) verification and a production build of the new pages have not been run.
- The brief's reading order puts the comparison with the proposed change and the source excerpt with the evidence; confirm that grouping with product.
- Issues' Created column shows relative ages, which the time contract allows; the brief's day-label rule applies to day headings. Confirm with product.
- Home's chart axis uses T034 while the EMCN charts use T050 for the same role; that predates this work.
