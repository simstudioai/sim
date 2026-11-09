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
| `refine(platform): align workspace controls, rows and type with Home and Integrations` | Only search fills the control bar's leading slot; issue rows center and the Created label meets its values; changelog entries take ActivityRow's roles; decisions use the secondary Button; OverflowText labels keep their parent's role, so logs and chart ticks read at regular weight. |
| `fix(platform): address the workspace sidebar review` | ControlBar takes search in its own slot; stress chat-panel recents point at stress workspaces; two stale doc sentences. |
| `refine(emcn): keep chart header controls inside the chart edge` | A chart's header control ends at its edge with the text inset, as Home's period does. |
| `refine(platform): keep workspace controls inside the column and follow Paper's rows` | The control bar no longer overhangs the column; issue groups and rows follow Integrations and Paper's IssueRow with a right-aligned date; log rows follow Paper's RunRow with data on the right. |
| `feat(platform): show a run's selected step beside its trace` | DetailSplit's ticket bar and inspector rail; run facts as Paper's metadata fields; the selected step's input and output in the inspector; records use DirectoryHeading and T093 sections. |
| `refactor(platform): render the dashboard table on EMCN DataTable` | The dashboard table adapts to DataTable, Paper's named owner. |
| `fix(platform): address the Paper alignment review` | The second review's findings: Used by's leftover inset, neutral table statuses in ink, a 32px group toggle, no empty inspector, a capped inspector and a narrower trace breakpoint, labelled metadata, Paper's caption gap, a primary column that never hides, a centered trace track, DataTable's header control inside its edge. |
| `refine(platform): keep record identifiers in their facts` | The ticket bar holds Back and the actions only; an issue's ID and a run's execution ID are facts. |
| `refine(platform): end the record rail's line at its content` | The rail's boundary spans its content with the same 8px above and below, its first line level with the heading. |
| `refine(platform): spell out Compute Units` | Run facts, the run list's column, sort and row names say Compute Units, never CU. |
| `refactor(platform): let workspace pages refresh themselves` | No refresh controls: Dashboard and Changelog keep their Updated caption, new runs join Logs without a button, and the session no longer tracks refreshes. |
| `test(platform): check self-refreshing pages, record facts and the rail line` | Each new check fails on the code before it; removing the rail's start alignment turns its check red. |
| `refine(platform): end each changelog entry with its ticket` | The ticket ends the contributor row, under the time, as Paper's ChangeEntry places it. |
| `refactor(platform): filter logs without a search` | Logs drops its search and the `q` parameter; status, trigger and workflow lead the bar and sort ends it. |
| `refine(platform): give every trace step its mark and hang tree guides` | The root shows its mark, so disclosure, mark and name are one gap apart on every row; hairline guides hang under open parents. |
| `refine(platform): align run facts and keep payload lines under their indent` | Metadata fields share columns and clamp to one line; payload lines wrap with a hanging indent and long payloads show 32 lines until asked; the copy action meets the text edge. |
| `refine(platform): scroll a stacked record as one` | Below 45rem the record's facts, reading column and inspector scroll together instead of in small nested scrollers. |
| `feat(platform): give example runs realistic payloads` | In `fixtures/workspace-data.ts`: a Slack trigger event, model requests and responses with tool calls, search results, a CRM record, directory groups, device inventory and policy rules. |
| `test(platform): check trace rows, the logs bar and changelog tickets` | The trace check fails when the root loses its mark or guides lose their line; the bar check fails with a search; the changelog check fails with the ticket beside the contributor. |

## Decisions to review

- Paper could not be read in this session (no Paper MCP), so the pages follow the contract JSONs and the brief. Compare Paper's Workspace shell for the tab order and labels, which follow the brief: Dashboard, Issues, Changelog, Logs.
- A live workspace row still opens the legacy workspace (`legacyRoutes.workspace`), since no live adapter feeds these pages yet. Fixture rows open Dashboard.
- `ShellWorkspace.workflows` stays: the composer's @-references list each workspace's workflows. Workspace changes render through EMCN ActivityRow, as Integrations' rows do: the glyph on the first line, title and type. Changed items without a page (workflows, tables, knowledge bases, files) are passive rows with no chevron; the external Notion page still links.
- Pages refresh themselves. Fixture time is fixed, so on fixtures the Updated age and the run list hold still; each live adapter will refetch in the background and report its last update.
- Workspace tabs scroll as one page in the shell's scroller, at least the viewport tall so empty states center beneath the controls. Record details are bounded panes where only the reading column scrolls.
- Issue group headers are a local toggle with Integrations' T059 group title and a chevron; Paper's IssueGroup uses T042. Issue titles hold one line and fade, with the full title in a tooltip and the link's name.
- Grouped and signed bars are local to Dashboard: one consumer each, so no EMCN variant. Trend, stacked bars and donut use the EMCN charts.
- Changelog details show WorkspaceChanges in the reading column, as the brief says, rather than in the rail, as Paper's desktop specimen does. A change shows no identifier of its own (its id is an internal slug); its issue is in the facts and behind View issue.
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

| Follow-up: changelog ticket, logs search, trace guides, payloads | Repo gate: `lint:check`, `check:audits` (68), `test:scripts` (845) and `type-check` pass. `workspace-pages`, `shell`, `panels` and `integration-center` on :3125: 29 of 31, and both failures pass on rerun (the shell drawer check twice, the Back restore 6 of 6 on repeat). Run details at 1440 light and dark, 901 and 390 on `full` and 1440 on `stress`; changelog at 1440 |
| Follow-up: identifiers, Compute Units, refresh, rail | `type-check:platform`, Biome, `check:platform-design`, `check:platform-css`, `check:platform-convergence` and `check:unused-exports` pass. `workspace-pages.spec.ts` 13/13 on :3125. Screenshots of issue, run, logs, dashboard and changelog at 1440 light, issue at 1440 dark and 390 light |

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

# Resource tabs — 2026-11-08

Tables, Files, Knowledge bases, Workflows and an empty Settings tab, on the same branch after `bc3c11d9a8`. Local and unpushed. The tabs are live-only ports of the legacy pages, exactly feature compatible apart from the removals the brief names; see [workspace UI](workspace-ui.md#resource-tabs).

## What landed

| Commit | Change |
| --- | --- |
| `feat(platform): add the workspace Files tab` | File browser, file view and every previewer and editor; the shared resource table, folder tree, drag and selection; the files data seam. |
| `refine(emcn): let command menus grow to their longest label` | Command menus size to their longest label instead of wrapping it. |
| `refactor(platform): share the markdown editor chrome and file previews` | The editor chrome and the previews its embeds render move to `workspace/[workspaceId]/_components/` for the canvas Note. |
| `refactor(platform): share the request-access dialog` | Settings' dialog moves to `(shell)/_components/` for the workflow toolbar and header. |
| `fix(platform): link workspaces straight to their home tab` | Rows link to Dashboard (fixtures) or Workflows (live) without the redirect hop. |
| `feat(platform): add the workspace Workflows tab` | List, editor, the legacy canvas copied view for view, toolbar, right panel, editor panel, deploy, terminal, variables; credential dialogs; the audit's workflow seam and canvas exceptions. |
| `feat(platform): add the workspace Knowledge bases tab` | Bases, documents, chunks, connectors in a rail and dialog. |
| `feat(platform): add the workspace Tables tab` | List and the legacy grid with every interaction, minus Import CSV and views. |
| `fix(platform): nest blocks dropped into loops and parallels` | Toolbar drops subtracted the canvas offset twice; legacy's canvas starts at the window corner, the tab's does not. |

Earlier commits on the branch added the breadcrumbs (`@sim/emcn/breadcrumbs`), the ControlBar trail, the tab frame's live mode, the shared realtime socket, page commands and tray clearance.

## Verified live (local stack: main app :3000, realtime :3002, zone :3126 against `simstudio_platform_test`)

- Tables: a 51k-row table scrolled end to end; every cell type; copy and paste; row inserts; column pin, resize, reorder, hide, insert and delete; find, sort and filter; the row modal; each Table Security lock; rename and delete; two pages editing at once; workflow columns run, stop and show executions; enrichments stop at the missing hosted provider keys.
- Files: browse, folders, upload, unzip, download, move, rename, share, delete; the viewer for each type; collaborative markdown.
- Knowledge bases: create, edit, delete, tags, documents, chunks; connectors added, configured, synced, paused and removed.
- Workflows: drag from the toolbar, loops and parallels with nesting, undo and redo, auto layout, fit view, a second page's cursor and live edits, runs into the Terminal; the canvas's computed styles match legacy on 615 elements in light and dark; the Note's slash menu, formatting bar, link card, image resize and code language picker.
- Deploy: deploy, redeploy, undeploy, promote and load versions, rename versions and edit descriptions, compare versions, the public API, API keys, chat and MCP deployment. AI descriptions only reached their error path (no provider key).
- Terminal and Variables: filters, views, search, copy, CSV export, clear, resize; variables add, rename, retype, edit and delete, synced to a second page and kept after reload.
- Nesting, checked against legacy with the same drag: a parallel dropped into a loop and a block dropped into that parallel nest and persist (it failed before the fix above; legacy nested the same drop).
- Credentials from the editor and from a knowledge connector: the OAuth dialog creates a draft credential, `/api/auth/oauth2/link` answers 200 and the browser is sent to Google's consent URL (intercepted). The secrets dropdown opens on `{{`; the Vanta client-credentials and Oracle Database wallet dialogs open from their pickers.

## Open items

- Seeded live workspaces have non-UUID ids, which file serving refuses (`parseWorkspaceFileKey`); file bytes were verified in a UUID workspace. Table CSV export 404s on local storage only (legacy too).
- @-mentions in the markdown editor list every catalog integration; legacy filters them by integration access. The fix needs a generated hidden-block set outside the registry; see the follow-ups.
- Note image paste reached the upload pipeline but the local upload-complete step answered 500 for the seeded workspace's storage key.
- The development zone needs `TRUSTED_ORIGINS` to include its own origin for OAuth links; behind the `/org` base path it shares the main app's origin.
- Workspace-scoped access requests open the workspace Settings tab's Requests section (`wip/ws-settings`).
- The local dev servers restart under memory pressure; browser checks against the dev preview time out on navigations that need a fresh compile.
