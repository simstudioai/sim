# Organization parity ledger

One row per capability of the legacy organization surface. Every capability is either done with a check that proves it, or recorded here with the reason it is not. Nothing is silently dropped.

| Domain | Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- | --- |
| Shell | Inbox panel | None; Platform only | Hidden | A per-user item feed with read state, its contract and publishers |
| Shell | Notification tray history | None; Platform only | Hidden | The same feed. Local notices and hook toasts still use the tray |
| Shell | Recents on Home and in the chat panel | None; Platform only | Hidden | A per-user recent destinations store. Only fixtures supply rows, so live data renders none |
| Shell | Sort workspaces | None; Platform only | Hidden | A per-user preference field. Order stays pinned, then by visits |
| Chat | Send, stream, stop, reconnect, resume on open and on return, queued handoff, withdrawal recovery, older pages, desktop tool execution | `useChat` | Done | The hook itself runs here through `lib/data/chat.ts`; `checks/live/chat.spec.ts` |
| Chat | Busy refusal, queue, send now, remove, edit, recall with Arrow Up, Enter sends the head | `useChat`, `queued-messages.tsx` | Done | `conversation/queued-messages.tsx`; `checks/live/chat.spec.ts` |
| Chat | Server-assigned id replaces the URL in place; Back and Forward restore it; a new chat on `/chat` resets the surface | `chat-url.ts`, `use-restored-chat-entry.ts` | Done | `isNewChatRoute` and `chatPath` options; `checks/live/chat.spec.ts` |
| Chat | Page gates: may build, chat access, Assistant chats open under Search | `chat/[chatId]/page.tsx` | Done | `live-chat-route.tsx`, `checks/live/chat.spec.ts` |
| Chat | Tool rows: executing, success, error, cancelled, skipped, rejected, interrupted | `tool-call-item.tsx` | Done | `message/tool-activity.tsx`; `checks/live/chat.spec.ts` |
| Chat | Tool approval: Allow, Don't ask again, Skip, Allow all, Skip all, expired | `tool-permission-card.tsx` | Done | `cards/tool-approval.tsx`, same contract and store; `checks/live/chat.spec.ts` |
| Chat | Question and options, answered recap, pairing to the hidden user message | `question.tsx`, `mothership-chat.tsx` | Done | `cards/question-card.tsx`, `pairInteractions` |
| Chat | Credential card: secrets in all three scopes, OAuth and Search connect rows, Submit message, recap | `special-tags.tsx` | Done | `cards/live-credential-card.tsx` over the same hooks |
| Chat | Assistant review: Allow, Cancel, edit drafts, bulk, receipts on the latest turn | `assistant-actions/review.tsx` | Done | `cards/assistant-review.tsx` over the same queries |
| Chat | Subagent lanes, nesting, held approvals outside the collapse | `agent-group-view.tsx` | Done | `message/lane-activity.tsx` |
| Chat | Markdown, code, tables, inline citations | `chat-content.tsx` | Done | `message/markdown-content.tsx`, same `streamdown` parser |
| Chat | Copy, rating with details, request id, fork | `message-actions.tsx` | Done | `message/response-actions.tsx` over the same mutations |
| Chat | Automated turn row | `mothership-chat.tsx` | Done | `Turn` in `conversation.tsx` |
| Chat | Composer: uploads with progress, drop, paste, persisted drafts, voice, effort, model, Fast and Plan behind their flags | `composer.tsx`, `use-file-attachments.ts` | Done | `lib/data/chat-composer.ts` |
| Chat | Skills in the `/` menu; workflows in the `+` menu | `composer.tsx` | Done | `lib/data/chat-composer.ts` |
| Chat | Resource panel: tabs, select, close, `?resource=`, auto reveal, activity state | `use-resource-panel.ts` | Done | `panel/resource-panels.tsx` over the same controller |
| Chat | Inline `@` mentions, tables, files, knowledge bases, chats and logs as references | `use-prompt-editor.ts`, `plus-menu-dropdown.tsx` | Open | Chat lane. Workflows and skills attach; the other kinds need their inventories in `useOrganizationReferences`. Legacy `/o/[id]/chat` still has them |
| Chat | Browser and Terminal as draft context; desktop browser and terminal tabs in the panel | `add-resource`, `use-browser-tab-resources.ts` | Open | Chat lane. Needs the desktop transports in the panel. The chat's tool execution on desktop is unaffected |
| Chat | Panel contents for file, table, workflow, dashboard, knowledge, log and folder; adding and reordering tabs; resize | `resource-content.tsx` | Legacy | Each tab links to its legacy workspace route: `panel/resource-content.tsx` |
| Chat | Sources panel and button, Find in chat, tool brand icons, virtualized transcript, animated placeholder, prompt history, suggested actions and Get started | `message-sources.tsx`, `use-chat-find.ts`, `suggested-actions.tsx` | Open | Chat lane. None holds a turn; the same chat opens fine on the legacy route |
| Chat | Service-account credential rows | `connect-service-account-modal` | Legacy | The row links to `/o/[id]/settings/integrations`, whose setup form is legacy UI |
| Chat | Plan-required modal on send | `use-chat-plan-required.ts` | Done | Workspace surfaces only by design; an organization relies on admission plus the usage notice |
| Search | Query, stop, re-run, New search, URL state with the legacy parsers | `search.tsx`, `search-params.ts` | Done | `search-surface/search-surface.tsx`; `checks/live/search.spec.ts` |
| Search | Results: searching, updating, error and retry, none, unavailable apps, partial, grouped by document | `knowledge-search-results.tsx` | Done | `_components/search/search-results.tsx` |
| Search | Source and date filters, custom range, keyboard movement | `search-filters.tsx` | Done | `_components/search/search-results.tsx` |
| Search | Source row: open, record, copy link, Summarize | `source-card.tsx` | Open | Chat lane. Open, record and copy work; Summarize needs a send into the mounted Assistant, and Create Sim link needs the Sim Links form |
| Search | History: recently viewed, recent searches, clear, retry | `search-landing-history.tsx` | Done | `search-surface.tsx` |
| Search | Search and Assistant switch, remembered per viewer, gated on `mothershipAvailable` | `search.tsx` | Done | `search-surface.tsx`; route gates in `live-search-route.tsx` |
| Search | Assistant conversation stays mounted under Search and keeps streaming | `search.tsx` | Done | `search-surface.tsx` |
| Home | Build enters a new chat through the handoff; Search goes to `/search?q=` | `organization-conversation.tsx` | Done | `home-composer.tsx`; `checks/live/chat.spec.ts` |
| Navigation | Benchmark | `/o/[id]/benchmark` | Legacy | Unmapped |
| Navigation | Skills | `/o/[id]/skills` | Legacy | Unmapped |
| Settings | Platform administration | `/o/[id]/settings/admin`, `/mothership` | Legacy | Unmapped; linked out for platform admins |
| Integrations | Credential pages, secrets, Search providers and sources | `/o/[id]/integrations/*`, `/settings/integrations/*`, `/settings/connected-accounts` | Legacy | Unmapped until the Integrations owner maps them |

Status is one of:

- **Done**: works on live data. Proof names a spec in `checks/live/`.
- **Legacy**: stays on the legacy surface and the Platform links out. Proof names the unmapped route in `lib/platform/routes.ts`.
- **Hidden**: Platform UI with no backend, hidden on live data. Reason names what a backend would need.
- **Open**: not built yet. Reason names the owner.
