# Workspace UI

Open [a workspace](http://localhost:3125/workspace/it/dashboards?state=full) on a fixture-enabled Platform server. A workspace row in the sidebar, a command-search result and a workspace in the chat panel all open the workspace's Dashboard. The organization sidebar stays as it is and marks the workspace's row current, as it marks Integrations; only the page on the right changes.

| Route under `/workspace/[workspaceId]` | UI owner |
| --- | --- |
| The workspace itself | Redirects to `dashboards`. |
| `dashboards` | The workspace's read-only production snapshot: metric groups, charts, a text summary, an agent roster and typed tables. |
| `issues`, `issues/[issueId]` | Agent-proposed issues in four groups, and an issue's proposal, impact and evidence with decisions in its control bar. |
| `changelog`, `changelog/[entryId]` | Applied changes by day, and a change's details with the workspace items it touched. |
| `logs`, `logs/[runId]` | Runs with filters and sort, and a run's trace, selected step and payloads. |

These are the workspace pages Paper has. A workspace has no chat, skills, resource or workflow page here: chats belong to the organization, and the composer's slash offers skills.

## Workspace pages

Dashboard, Issues, Changelog and Logs are one family of Platform pages, styled from Home and Integrations. [Dashboard](http://localhost:3125/workspace/it/dashboards?state=full), [Issues](http://localhost:3125/workspace/it/issues?state=full), [Changelog](http://localhost:3125/workspace/it/changelog?state=full) and [Logs](http://localhost:3125/workspace/it/logs?state=full) open on any fixture workspace; `?state=stress` exercises the extremes and `?state=empty` every empty state.

- **Frame.** `WorkspacePage` puts the workspace name and description in the Integrations heading, the four pages in DestinationTabs and the tab's ControlBar beneath them, at the same positions as the integration center. A search field fills the bar's leading edge; a choice keeps its text width, as Home's period does. Like Home's controls, the bar's surfaces stay inside the column and their text is inset, so a leading choice lines up with the tab labels above it. The page is at least the viewport tall, so an empty state centers in the space below the controls.
- **Rows.** Lists follow Paper's rows and the shared recipes. Issue groups take Integrations' group title with a chevron; an issue row is a caption ID, a one-line title and a right-aligned date (IssueRow). Log rows put duration, usage and start time on the right (RunRow). Changelog entries take ActivityRow's title, detail and meta roles. The dashboard's typed table is EMCN DataTable.
- **Details.** `DetailSplit` is shared by issue, change and run details: Paper's ticket bar puts the Integrations Back chip, the record's identifier and its actions on one row; a reading column scrolls with its edge fade beside a rail with a 24px inset and a hairline boundary. Issue and change details use a 280px facts rail. Run details keep the run's metadata fields and trace in the reading column and give the rail to the selected step: its facts, then input and output in Paper's trace-payload form with the chat tool payload's monospace. Below a 45rem frame facts move above the reading column and an inspector below it. Record headings and section titles match Integrations' details (DirectoryHeading, T093). Decisions use the secondary compact Button, as Connect does.
- **URL state.** Search, filters, sort and period live in the URL through nuqs (`lib/workspace-views.ts`). A row carries its list's view into the record's URL, so the Back chip returns to the same filtered, sorted list.
- **Reading position.** A list remembers its scroll position when a click leaves it. Browser Back and Forward and the record's Back chip restore it; a tab or sidebar visit starts at the top. The router renders a history step inside the popstate dispatch and scrolls a link's destination into view itself, so the page restores on the next frame and marks the shell's scroller so the shell does not reset it.
- **Paging.** Lists reveal records in pages as the reader nears the end, with no label, spinner or end marker; the shell's edge fade shows content continues. A revealed count survives Back.
- **Session.** Example decisions on issues, refreshes and the new runs a reader brings in change only the browser session (`workspace-session/`). Nothing is sent or stored.
- **Data.** Each route is a server component that loads server-gated fixtures and passes `data` to a client route, which supplies `actions` from the session. A live workspace row opens the authorized legacy workspace, and live Dashboard, Changelog and Logs URLs redirect there until an adapter maps the existing hooks onto the same props. Issues has no backend, so its live URLs answer 404. See the [parity ledger](org-parity.md#workspace-pages).
