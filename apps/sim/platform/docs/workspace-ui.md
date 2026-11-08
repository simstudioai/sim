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

- **Frame.** `WorkspacePage` puts the workspace name and description in the Integrations heading, the four pages in DestinationTabs and the tab's ControlBar beneath them, at the same positions as the integration center. A search field fills the bar's leading edge; a choice keeps its text width, as Home's period does. The page is at least the viewport tall, so an empty state centers in the space below the controls.
- **Rows.** Lists use the shared row recipes: issue rows center one line of text in DataTable's 40px row, changelog entries take ActivityRow's title, detail and meta roles, and log rows read at DataTable's regular weight.
- **Details.** `DetailSplit` is shared by issue, change and run details: the Integrations Back chip, pinned controls, a reading column that alone scrolls with its edge fade, and a 280px facts rail with a 24px inset and a hairline boundary. Below a 45rem frame the facts move above the reading column. Decisions use the secondary compact Button, as Connect does.
- **URL state.** Search, filters, sort and period live in the URL through nuqs (`lib/workspace-views.ts`). A row carries its list's view into the record's URL, so the Back chip returns to the same filtered, sorted list.
- **Reading position.** A list remembers its scroll position when a click leaves it. Browser Back and Forward and the record's Back chip restore it; a tab or sidebar visit starts at the top. The router renders a history step inside the popstate dispatch and scrolls a link's destination into view itself, so the page restores on the next frame and marks the shell's scroller so the shell does not reset it.
- **Paging.** Lists reveal records in pages as the reader nears the end, with no label, spinner or end marker; the shell's edge fade shows content continues. A revealed count survives Back.
- **Session.** Example decisions on issues, refreshes and the new runs a reader brings in change only the browser session (`workspace-session/`). Nothing is sent or stored.
- **Data.** Each route is a server component that loads server-gated fixtures and passes `data` to a client route, which supplies `actions` from the session. A live workspace row opens the authorized legacy workspace, and live Dashboard, Changelog and Logs URLs redirect there until an adapter maps the existing hooks onto the same props. Issues has no backend, so its live URLs answer 404. See the [parity ledger](org-parity.md#workspace-pages).
