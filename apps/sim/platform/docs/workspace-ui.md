# Workspace UI

Open [Workspace](http://localhost:3125/workspace/operations/chat?state=full) on a fixture-enabled Platform server. Workspace selections from the sidebar, command search and the chat panel use the same destination. Back returns to organization Home. The organization header, profile, Help, toolbar and native desktop controls stay in the existing shell. The workspace navigation also supplies command-search destinations.

| Route under `/workspace/[workspaceId]` | UI owner |
| --- | --- |
| `chat`, `chat/[id]` | The Platform conversation renderer and Chats section show the selected workspace’s new and existing conversations. |
| `integrations`, `integrations/[provider]`, `integrations/connected/[id]` | Redirects to the organization integration center, the single owner of provider connections and sharing. |
| `skills`, `skills/new`, `skills/[id]` | Workspace skills, with a slash for each entry, built-in and member skills, editing, sharing and Markdown import. The workspace layout owns preview skill edits. |
| `tables`, `files`, `knowledge`, `tests`, `logs`, `dashboards`, `changelog` | The isolated fixture document uses the existing workspace Resource header, tables, search, sort and resource empty states. |
| `w`, `w/[workflowId]` | The workflow list opens the selected canvas. The preview uses the existing React Flow stage and Sim workflow node and edge renderers. |

The legacy workspace entry chose Chat or the first workflow. The old rail put Skills inside Integrations and gated resources by workspace policy and feature availability. The workspace opens on New chat. Skills has its own tab. Workspace chats stay in the workspace sidebar and organization chats stay in the organization sidebar. Dashboard and Changelog are resource destinations in the full-access preview. Changelog is absent from Help.

`dev:platform` and `build:platform` compile `apps/sim/workspace-preview` into a private fixture document. The server fixture flag gates both its HTML and assets. The document owns its legacy styles and shares neither a sidebar nor a provider with the parent document. The parent owns the visible route and browser history. Use `build:workspace-preview` after changing the legacy preview source during development.

This is the UI phase. Integration-center credentials and workspace skills change locally. The resource and workflow previews display example content and support local interactions. Authenticated users continue on the authorized legacy workspace routes until the workspace data adapter is connected. The legacy layout checks membership and enforces its resource gates before showing workspace data.
