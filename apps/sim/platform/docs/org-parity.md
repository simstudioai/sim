# Organization parity ledger

One row per capability of the legacy organization surface. Every capability is either done with a check that proves it, or recorded here with the reason it is not. Nothing is silently dropped.

| Domain | Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- | --- |
| Shell | Inbox panel | None; Platform only | Hidden | A per-user item feed with read state, its contract and publishers |
| Shell | Notification tray history | None; Platform only | Hidden | The same feed. Local notices and hook toasts still use the tray |
| Shell | Recents in the chat panel | None; Platform only | Hidden | A per-user recent destinations store. Only fixtures supply rows, so live data renders none |
| Shell | Sort workspaces | None; Platform only | Hidden | A per-user preference field. Order stays pinned, then by visits |
| Navigation | Search and Search chats | `/o/[id]/search` | Legacy | Unmapped; Open for its own owner |
| Navigation | Benchmark | `/o/[id]/benchmark` | Legacy | Unmapped |
| Navigation | Skills | `/o/[id]/skills` | Legacy | Unmapped |
| Settings | Platform administration | `/o/[id]/settings/admin`, `/mothership` | Legacy | Unmapped; linked out for platform admins |
| Integrations | Credential pages, secrets, Search providers and sources | `/o/[id]/integrations/*`, `/settings/integrations/*`, `/settings/connected-accounts` | Legacy | Unmapped until the Integrations owner maps them |

Status is one of:

- **Done**: works on live data. Proof names a spec in `checks/live/`.
- **Legacy**: stays on the legacy surface and the Platform links out. Proof names the unmapped route in `lib/platform/routes.ts`.
- **Hidden**: Platform UI with no backend, hidden on live data. Reason names what a backend would need.
- **Open**: not built yet. Reason names the owner.

## Home

| Domain | Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- | --- |
| Home | Personal greeting | `app/o/[id]/components/organization-conversation.tsx` | Done | `checks/live/home.spec.ts`. Name from the profile, time of day from the viewer's clock; `Welcome` until hydration knows it |
| Home | Gate for members who cannot build | `app/o/[id]/home/home-redirect.ts` | Done | `home-server.ts` `resolveHomeRedirect`, the same order: Search if member-scoped, else workspace settings. Runs on the server before anything renders |
| Home | Email widget: read the viewer's mail | None; Platform only | Done | `home-widgets.integration.ts`, `provider-reads.test.ts`. Gmail threads and Outlook inbox through the existing tool logic, metadata only for Gmail; `GET /api/organizations/[id]/home/email`, session only, the acting member's own grants |
| Home | Calendar widget: read a day of meetings | None; Platform only | Done | `home-widgets.integration.ts`. Primary Google calendar and default Outlook calendar; `GET .../home/calendar?date=&timeZone=`. Previous and next day read for real; all-day events sit above the timeline; overlapping meetings share lanes |
| Home | Connect, reconnect, disconnect from a widget | Integrations page | Done | Same operations as Integrations: `useConnectOrganizationAccount`, `useReconnectPersonalOrganizationAccount`, `useDisconnectPersonalOrganizationAccount`. The disconnect dialog says it reaches everywhere the account is used |
| Home | Widget offered only when the organization offers it | Member inventory | Done | `memberIntegrationEntries` moved to `lib/credential-groups/member-integrations.ts`, read by both surfaces. `home-model.test.ts`. No Connect appears for a provider the inventory does not mark connectable, and the server re-checks approval, permission group and content boundary on every read |
| Home | Widget states: loading, not offered, not connected, reconnect, retry, empty, partial | None; Platform only | Done | `home-model.test.ts`; each renders differently in `connected-widget.tsx`. One failing account never hides the others |
| Home | Mail when the organization restricts that source's content | Search source policy | Hidden | A source in scoped mode (selected labels, excluded categories) cannot be read directly: `requireAssistantProviderAccess` refuses it, as it refuses the assistant's direct tools. The widget reads as not offered. Honoring the scope needs the Search policy verifier over a mailbox listing |
| Home | Gmail thread open target | None; Platform only | Done | Opens `mail.google.com/mail/u/0/#inbox/<id>`, the same form Search results use, so it opens the browser's first Google account |
| Home | Calendars other than the primary one | None; Platform only | Hidden | The widget reads each account's primary or default calendar. Others need a calendar picker and a place to store the choice |
| Home | Activity chart: Tasks run | `ee/organization-usage` | Done | `useOrganizationActivitySummary`, 90 days of the viewer's calendar days, counting workflow runs plus chat runs. The read is org-wide, admin-only and entitlement-gated, so anyone it would refuse sees no chart and no Customize entry, never an empty one. `checks/live/home.spec.ts` |
| Home | Activity chart for ordinary members | None; Platform only | Hidden | Needs a member-scoped activity read. Organization-wide counts are not theirs to see |
| Home | Activity chart: Searches | None; Platform only | Hidden | No truthful source: `organization_search_history` keeps 20 rolling entries per person, assistant chats count conversations rather than searches, and `organization_search_mcp_invocation` covers MCP alone. Needs a search event or counter table. Search mode shows no chart and drops it from Customize |
| Home | Recents | None; Platform only | Done | `useSearchHistory` sources, gated on member-scoped Search. `×` removes the source for real through the new `DELETE .../search/history/sources`, restored if the server refuses. `history.integration.ts` |
| Home | Recents the panel shows for files and workspaces | None; Platform only | Hidden | A per-user recent destinations store |
| Home | Needs your attention | None; Platform only | Done | Composed from accounts awaiting reconnection, unread chats and, for those who review them, pending access requests. A failed source shows a retry rather than a false "all caught up" |
| Home | Cross-chat approvals in Needs your attention | None; Platform only | Hidden | Pending tool permissions and assistant reviews are listed per chat. Needs a member-scoped list across chats |
| Home | Customize Home | None; Platform only | Hidden | Session scope, as `hiddenWidgets` already was: `settings` has no column for it and a new one needs a migration. Hide and Undo work; a reload restores every widget |
| Home | Get started checklist | `app/o/[id]/home/components/get-started/get-started.tsx` | Done | Same steps, gates and completion rules, in Search mode as legacy shows it on the Search landing. Admin integration step and Sim Search MCP link to their legacy settings sections |
| Home | Suggested action rows and Connect from a suggestion | `suggested-actions.tsx` | Open | Chat lane. Needs the block template catalog (337-file closure, banned by the seam) behind a route, and a way to hand a prompt to the composer draft. Recents hold that slot on Platform |
| Home | Plan toggle, composer handoff and server chat id | `organization-conversation.tsx` | Open | Chat lane owns `home-composer` |
