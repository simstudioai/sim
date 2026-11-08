# Workspace UI

Open [Workspace](http://localhost:3125/workspace/operations/chat?state=full) on a fixture-enabled Platform server. Workspace selections from the sidebar, command search and the chat panel use the same destination. Back returns to organization Home. The organization header, profile, Help, toolbar and native desktop controls stay in the existing shell. The workspace navigation also supplies command-search destinations.

| Route under `/workspace/[workspaceId]` | UI owner |
| --- | --- |
| `chat`, `chat/[id]` | The Platform conversation renderer and Chats section show the selected workspace’s new and existing conversations. |
| `integrations`, `integrations/[provider]`, `integrations/connected/[id]` | Redirects to the organization integration center, the single owner of provider connections and sharing. |
| `skills`, `skills/new`, `skills/[id]` | Workspace skills, with a slash for each entry, built-in and member skills, editing, sharing and Markdown import. The workspace layout owns preview skill edits. |
| `dashboards` | The workspace's read-only production snapshot: metric groups, charts, a text summary, an agent roster and typed tables. |
| `issues`, `issues/[issueId]` | Agent-proposed issues in four groups, and an issue's proposal, impact and evidence with decisions in its control bar. |
| `changelog`, `changelog/[entryId]` | Applied changes by day, and a change's details with the workspace items it touched. |
| `logs`, `logs/[runId]` | Runs with filters and sort, and a run's trace, selected step and payloads. |
| `tables`, `files`, `knowledge`, `tests` | The isolated fixture document uses the existing workspace Resource header, tables, search, sort and resource empty states. |
| `w`, `w/[workflowId]` | The workflow list opens the selected canvas. The preview uses the existing React Flow stage and Sim workflow node and edge renderers. |

## Workspace pages

Dashboard, Issues, Changelog and Logs are one family of Platform pages, styled from Home and Integrations. [Dashboard](http://localhost:3125/workspace/it/dashboards?state=full), [Issues](http://localhost:3125/workspace/it/issues?state=full), [Changelog](http://localhost:3125/workspace/it/changelog?state=full) and [Logs](http://localhost:3125/workspace/it/logs?state=full) open on any fixture workspace; `?state=stress` exercises the extremes and `?state=empty` every empty state.

- **Frame.** `WorkspacePage` puts the workspace name and description in the Integrations heading, the four pages in DestinationTabs and the tab's ControlBar beneath them, at the same positions as the integration center. The page is at least the viewport tall, so an empty state centers in the space below the controls.
- **Details.** `DetailSplit` is shared by issue, change and run details: the Integrations Back chip, pinned controls, a reading column that alone scrolls with its edge fade, and a 280px facts rail with a 24px inset and a hairline boundary. Below a 45rem frame the facts move above the reading column.
- **URL state.** Search, filters, sort and period live in the URL through nuqs (`lib/workspace-views.ts`). A row carries its list's view into the record's URL, so the Back chip returns to the same filtered, sorted list.
- **Reading position.** A list remembers its scroll position when a click leaves it. Browser Back and Forward and the record's Back chip restore it; a tab or sidebar visit starts at the top. The router renders a history step inside the popstate dispatch and scrolls a link's destination into view itself, so the page restores on the next frame and marks the shell's scroller so the shell does not reset it.
- **Paging.** Lists reveal records in pages as the reader nears the end, with no label, spinner or end marker; the shell's edge fade shows content continues. A revealed count survives Back.
- **Session.** Example decisions on issues, refreshes and the new runs a reader brings in change only the browser session (`workspace-session/`). Nothing is sent or stored.
- **Data.** Each route is a server component that loads server-gated fixtures and passes `data` to a client route, which supplies `actions` from the session. Live workspaces keep their legacy pages until an adapter maps the existing hooks onto the same props; Issues has no backend and stays hidden there. See the [parity ledger](org-parity.md#workspace-pages).

## Legacy preview

The legacy workspace entry chose Chat or the first workflow. The old rail put Skills inside Integrations and gated resources by workspace policy and feature availability. The workspace opens on New chat. Skills has its own tab. Workspace chats stay in the workspace sidebar and organization chats stay in the organization sidebar. Changelog is absent from Help.

`dev:platform` and `build:platform` compile `apps/sim/workspace-preview` into a private fixture document for tables, files, knowledge, tests and workflows. The server fixture flag gates both its HTML and assets. The document owns its legacy styles and shares neither a sidebar nor a provider with the parent document. The parent owns the visible route and browser history. Use `build:workspace-preview` after changing the legacy preview source during development.

This is the UI phase. Integration-center credentials and workspace skills change locally. The resource and workflow previews display example content and support local interactions. Authenticated users continue on the authorized legacy workspace routes until the workspace data adapter is connected. The legacy layout checks membership and enforces its resource gates before showing workspace data.
