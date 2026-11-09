# Organization parity ledger

One row per capability of the legacy organization surface. Every capability is either done with a check that proves it, or recorded here with the reason it is not. Nothing is silently dropped. `scripts/check-platform-parity.ts` holds this file to the specs, and the `live` job in `platform-design.yml` holds it to the run: a Done row whose quoted test failed or was skipped fails the job.

| Domain | Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- | --- |
| Shell | Inbox panel | None; Platform only | Hidden | A per-user item feed with read state, its contract and publishers |
| Shell | Notification tray history | None; Platform only | Hidden | The same feed. Local notices and hook toasts still use the tray |
| Shell | Recents in the chat panel | None; Platform only | Hidden | A per-user recent destinations store. Only fixtures supply rows, so live data renders none |
| Shell | Sort workspaces | None; Platform only | Hidden | Nothing stores a sort choice, so `unbacked` hides the control. Order stays pinned, then by the viewer's visits, through `useOrderedWorkspacesQuery` |
| Shell | Oversized paste refused before an editor parses it | `app/_shell/paste-admission-guard.tsx` | Done | `paste-guard.test.tsx`, mounted without an element in `LiveProviders`. Zone fields publish no `data-paste-*` ceilings yet, so only the crash-only fallback applies; fixture sessions have no guard |
| Shell | A tab title per route | Each legacy page's `metadata` | Done | "Each route names its own tab". Bare titles: no brand suffix, which legacy reads from whitelabeling. A Settings provider page reads Integration, not the provider's name |
| Shell | Desktop tray: recents, New Chat, Settings, on/off | `apps/desktop/src/main/tray.ts`, `/workspace/[id]/settings/desktop` | Open | Native, and New Chat and Settings resolve from a zone route. Recents read workspace chats from `/api/copilot/chats`, so organization chats are not listed, and the on/off switch has only the workspace Desktop page |
| Shell | Warm a destination on pointer dwell | `nav-warmers.ts` | Open | `useNavWarmers` in `lib/data/nav-warmers.ts` is ready and proved by `nav-warmers.test.tsx`. The sidebar's destination rows have no pointer handler to call it, which is the sidebar owner's move |
| Chat | Send, stream, stop, reconnect, resume on open and on return, withdrawal recovery, older pages, desktop tool execution | `useChat` | Unverified | Send, stream and stop are proved by "A running turn streams, stops" against a scripted worker. Reconnect, resume, withdrawal recovery, older pages and desktop tools have no live check, and no real model has run |
| Chat | Steering: a message sent while a turn runs steers it, shows at once and settles where the turn applied it; one the turn ends without applying goes out as the next turn; a busy refusal steers the turn that holds the chat; a message shown as not delivered offers Retry and Dismiss | `useChat`, `outgoing-state.ts`, `steered-messages.ts` | Unverified | Applying is proved by "A message sent during a running turn steers it" against a scripted worker, and the not-applied fallback by "A message the turn ends without applying goes out as the next turn". The busy refusal has no live check |
| Chat | Server-assigned id replaces the URL in place; Back and Forward restore it; a new chat on `/chat` resets the surface | `chat-url.ts`, `use-restored-chat-entry.ts` | Unverified | No live check yet. `isNewChatRoute` and `chatPath` options |
| Chat | Page gates: may build, chat access, Assistant chats open under Search | `chat/[chatId]/page.tsx` | Done | "a member who cannot build lands on Search", "A chat outside the viewer’s access is not found" |
| Chat | Tool rows: executing, success, error, cancelled, skipped, rejected, interrupted | `tool-call-item.tsx` | Unverified | No live check yet. `message/tool-activity.tsx` |
| Chat | Tool approval: Allow, Don't ask again, Skip, Allow all, Skip all, expired | `tool-permission-card.tsx` | Unverified | "A gated tool holds the turn" needs a prompt that triggers a gated tool, which the scripted worker does not send yet; it is reported as a skip |
| Chat | Question and options, answered recap, pairing to the hidden user message | `question.tsx`, `mothership-chat.tsx` | Unverified | No live check yet. `cards/question-card.tsx`, `pairInteractions` |
| Chat | Credential card: secrets in all three scopes, OAuth and Search connect rows, Submit message, recap | `special-tags.tsx` | Unverified | No live check yet. `cards/live-credential-card.tsx` over the same hooks |
| Chat | Assistant review: Allow, Cancel, edit drafts, bulk, receipts on the latest turn | `assistant-actions/review.tsx` | Unverified | No live check yet. `cards/assistant-review.tsx` over the same queries |
| Chat | Subagent lanes, nesting, held approvals outside the collapse | `agent-group-view.tsx` | Unverified | No live check yet. `message/lane-activity.tsx` |
| Chat | Markdown, code, tables, inline citations | `chat-content.tsx` | Unverified | No live check yet. `message/markdown-content.tsx`, same `streamdown` parser |
| Chat | Copy, rating with details, request id, fork | `message-actions.tsx` | Unverified | No live check yet. `message/response-actions.tsx` over the same mutations |
| Chat | Automated turn row | `mothership-chat.tsx` | Unverified | No live check yet. `Turn` in `conversation.tsx` |
| Chat | Composer: uploads with progress, drop, paste, persisted drafts, voice, effort, model, Fast and Plan behind their flags | `composer.tsx`, `use-file-attachments.ts` | Unverified | No live check yet. `lib/data/chat-composer.ts` |
| Chat | Skills in the `/` menu; workflows in the `+` menu | `composer.tsx` | Unverified | No live check yet. `lib/data/chat-composer.ts` |
| Chat | Resource panel: tabs, select, close, `?resource=`, auto reveal, activity state | `use-resource-panel.ts` | Unverified | Only the URL is proved, by "A resource in the URL survives a reload". The panel itself has no live check |
| Chat | Inline `@` mentions, tables, files, knowledge bases, chats and logs as references | `use-prompt-editor.ts`, `plus-menu-dropdown.tsx` | Open | Chat lane. Workflows and skills attach; the other kinds need their inventories in `useOrganizationReferences`. Legacy `/o/[id]/chat` still has them |
| Chat | Browser and Terminal as draft context; desktop browser and terminal tabs in the panel | `add-resource`, `use-browser-tab-resources.ts` | Open | Chat lane. Needs the desktop transports in the panel. The chat's tool execution on desktop is unaffected |
| Chat | Panel contents for file, table, workflow, dashboard, knowledge, log and folder; adding and reordering tabs; resize | `resource-content.tsx` | Legacy | Each tab links to its legacy workspace route: `panel/resource-content.tsx` |
| Chat | Sources panel and button, Find in chat, tool brand icons, virtualized transcript, animated placeholder, prompt history, suggested actions and Get started | `message-sources.tsx`, `use-chat-find.ts`, `suggested-actions.tsx` | Open | Chat lane. None holds a turn; the same chat opens fine on the legacy route |
| Chat | Service-account credential rows | `connect-service-account-modal` | Legacy | The row links to `/o/[id]/settings/integrations`, whose setup form is legacy UI |
| Chat | Plan-required modal on send | `use-chat-plan-required.ts` | Unverified | No live check yet. Workspace surfaces only by design; an organization relies on admission plus the usage notice |
| Search | Query, stop, re-run, New search, URL state with the legacy parsers | `search.tsx`, `search-params.ts` | Done | "A query lands in the URL". Stop and New search have no live check |
| Search | Results: searching, updating, error and retry, none, unavailable apps, partial, grouped by document | `knowledge-search-results.tsx` | Unverified | No live check yet. `_components/search/search-results.tsx` |
| Search | Source and date filters, custom range, keyboard movement | `search-filters.tsx` | Done | "A query lands in the URL" covers the date filter. Source filters and a custom range have no live check |
| Search | Source row: open, record, copy link | `source-card.tsx` | Unverified | No live check yet. `lib/data/search.ts` |
| Search | Source row: Summarize, scoped to that document, hand-off to Assistant | `source-card.tsx`, `use-organization-conversation.ts` | Done | "Summarize on a result switches to Assistant" |
| Search | Source row: Create Sim link | `source-card.tsx` | Open | Chat lane. Needs the Sim Links form |
| Search | History: recently viewed, recent searches, clear, retry | `search-landing-history.tsx` | Unverified | No live check yet. `search-surface.tsx` |
| Search | First paint of history | `prefetch.ts` | Done | `prefetch-reads.test.ts` |
| Search | Search and Assistant switch, remembered per viewer, gated on `mothershipAvailable` | `search.tsx` | Unverified | No live check yet. `search-surface.tsx`; route gates in `live-search-route.tsx` |
| Search | Assistant conversation stays mounted under Search and keeps streaming | `search.tsx` | Unverified | No live check yet. `search-surface.tsx` |
| Home | Build enters a new chat through the handoff; Search goes to `/search?q=` | `organization-conversation.tsx` | Done | "Home hands a draft to a new chat", "Home’s Search segment opens Search" |
| Navigation | Benchmark | `/o/[id]/benchmark` | Legacy | Unmapped |
| Navigation | Skills: list per workspace, create, import, edit, delete, built-ins read-only, editors | `/workspace/[id]/skills`, `/o/[id]/skills` | Unverified | No live check yet. `/integrations?tab=skills&workspace=<id>`; `lib/data/skills`. Instructions use the large textarea, not legacy's rich editor |
| Settings | Platform administration: Admin | `/o/[id]/settings/admin` | Unverified | No live check yet. `/settings/admin`, platform admins only. The legacy URL stays unmapped and keeps its own page |
| Settings | Platform administration: Mothership | `/o/[id]/settings/mothership` | Unverified | No live check yet. `/settings/mothership`, platform admins only. The legacy URL maps here |
| Integrations | Member inventory and account pages | `/o/[id]/integrations`, `/o/[id]/integrations/[provider]` | Unverified | No live check yet. `/integrations` and `/integrations/[providerId]`. `/integrations` maps here unless its query asks for a job the zone cannot do; `/integrations/[provider]` stays unmapped and keeps its own page |
| Integrations | Member secrets, per-account tool permissions | `/o/[id]/integrations/secrets`, `/o/[id]/integrations/accounts/[credentialId]` | Legacy | Unmapped. Generic secrets link out through `legacyRoutes` |
| Integrations | Search sources: list, secrets, provider and source pages | `/o/[id]/settings/integrations/*` | Unverified | No live check yet. `/settings/integrations` with `secrets`, `providers/:connectorType` and `sources/:connectorId`. The legacy URLs stay unmapped and keep their own pages |
| Integrations | Credential Groups | `/o/[id]/settings/connected-accounts` | Unverified | No live check yet. `/settings/connected-accounts`. The legacy URL stays unmapped and keeps its own page |
| Integrations | First paint of the inventory | `settings-query-warmers.ts`, `prefetch-member-inventory.ts` | Done | `prefetch-reads.test.ts` |
| Integrations | Member inventory page | `/o/[id]/integrations` | Open | Integrations owner. `lib/platform/routes.ts` maps the plain page. Slack handoff, connection requests and saved-account connect stay on the legacy page until the zone has them |

## Settings: personal

| Domain | Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- | --- |
| Preferences | Display name read and edit, pending, inline failure | General | Done | "a display name saves" |
| Preferences | Picture upload, 5MB and type validation, failure notice | General | Unverified | No live check yet. Same hook as legacy (`hooks/use-profile-picture-upload`); not exercised in which uploads no file |
| Preferences | Avatar fallback to the whitelabel logo | General | Hidden | Legacy mounts no brand provider on `/o`, so the organization surface never showed it. Applying a brand to the Platform needs its token mapping |
| Preferences | Theme persisted, optimistic, applied to the shell | General | Done | "a theme chosen here persists" |
| Preferences | Time zone with Auto and invalid-value rows | General | Unverified | "the time zone offers Auto" reads the row; no check writes it |
| Preferences | Auto-connect, auto-focus, snap to grid, canvas controls | General | Unverified | No live check yet. The legacy explainer videos are not ported: they are static assets of the main app |
| Preferences | Interface font, Code font | None; Platform only | Hidden | No font preference exists. Needs a settings column |
| Notifications | Canvas error notifications | General | Done | "a notification preference writes", "unbacked preferences stay out" |
| Notifications | In-app notifications, Play sound | None; Platform only | Hidden | No user setting. Sound exists only on the Electron bridge |
| Notifications | Billing usage email | Billing, account scope | Legacy | Legacy shows it on personal billing only, which is not on the organization surface |
| Keyboard shortcuts | Static list | None; Platform only | Done | "privacy and shortcuts render" |
| Privacy | Browser telemetry, opt-out first, rollback on failure | General privacy view | Unverified | "privacy and shortcuts render" shows the switch; opt-out and rollback have no live check |
| Privacy | Cookie choices, commit per toggle, revert on failure | General privacy view | Unverified | No live check yet. Hosted only; the same consent store, mounted on this section. Needs a hosted environment to prove, so not in |
| Privacy | Consent banner on first visit | Root layout | Legacy | Shown on entry routes of the main app, which owns the consent lifecycle |
| Account | Home page action | General | Unverified | No live check yet. Hosted only, same gate |
| Account | Sign out | General | Unverified | No live check clicks this entry: it would end the session the suite shares. The shell entry is proved by "sign out ends the session" |
| Account | Reset password email | General | Unverified | No live check yet |
| Account | Authorized apps: search, paging, revoke | Authorized apps | Unverified | No live check yet. Covers the list; revoke needs a seeded OAuth grant |
| Account | Organization accounts: grouped, status, disconnect | Organization accounts | Unverified | No live check yet. Covers the list; disconnect needs a seeded grant |
| Account | Delete account: fresh plan on open, blockers, retyped email, bounded sign-out | Delete account modal | Unverified | Blockers and the disabled action are proved by "account deletion is refused". The retyped email cannot be reached by anyone on this surface: every member has a blocker |
| Knowledge graphs | List, make active, create | Knowledge graphs | Unverified | No live check yet. Gate is `settingsSections`; needs `mothership-memory-spaces` on, so not in |
| Recently deleted | Deleted chats: search, sort, restore | Recently deleted | Done | "a deleted chat restores", "recently deleted separates". Search and sort have no live check |

## Settings: billing and usage

| Domain | Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- | --- |
| Billing | Section gate | `settingsSections` | Done | "renders healthy in both themes" |
| Billing | First-paint read, failure with retry | Billing | Unverified | The server read is proved by "a plan read on the server stands". The failure state needs the Platform server's own read to fail, which no browser stub can do |
| Billing | Plan name, price, lapsed and free copy | Billing | Unverified | No live check yet. Same derivations; needs a seeded subscription for each state |
| Billing | Explore plans link | Billing | Unverified | No live check yet. Links to `/settings/billing/plans` |
| Billing | Plan picker: plans, period, checkout, switch, contact, upgrade reasons, self-hosted and billing-off gates | `/workspace/[id]/upgrade` | Unverified | No live check yet. `/settings/billing/plans`, `lib/data/plans.ts`; needs Stripe |
| Billing | Usage limit: credits, autosave, minimum, unsaved guard | Billing | Unverified | No live check yet. Shared decision in `lib/billing/usage-limit-draft`; needs a paid subscription to prove |
| Billing | On-demand switch and lock | Billing | Unverified | No live check yet. Lock explained in the row's description where legacy used a tooltip |
| Billing | Stripe portal, cancel, restore | Billing | Unverified | No live check yet. Existing operations. Needs Stripe, so live |
| Billing | Invoices | Billing | Unverified | No live check yet. Needs Stripe, so live |
| Billing | Personal plan, personal credit usage | Billing, account scope | Legacy | Not on the organization surface |
| Billing | Client plan refresh on focus | Organization sidebar | Open | Shell owner: it changes navigation, which this section does not own |
| Usage | Tabs, period presets, custom range capped by the contract | Insights | Done | "Insights keeps its window" |
| Usage | Export CSV with truncation notice | Insights | Done | "Insights keeps its window" downloads the CSV. Truncation has no live check |
| Usage | All events, keeping the window | Insights | Done | "Insights keeps its window" |
| Usage | Credits chart with six fixed layers, tooltip, legend | Insights | Unverified | No live check yet. Legend hover isolation is not ported: the shared chart has no highlight state |
| Usage | Year heatmap with keyboard movement | Insights | Done | "Insights keeps its window" shows it; keyboard movement has no live check |
| Usage | Top models and members, View all | Insights | Unverified | No live check yet |
| Usage | Ranked lists: Other row expands, row select, row menu | Insights | Unverified | No live check yet. Share reads as a percent column where legacy drew a bar |
| Usage | Workspace drill-down, Open logs | Insights | Unverified | No live check yet. Open logs keeps its hosted or `auditLogs` gate |
| Usage | Activity summary, breakdown, paging, 404 recovery | Insights | Done | "Insights keeps its window" shows the breakdown; paging and 404 recovery have no live check |
| Usage | Manage member credits | Insights | Unverified | No live check yet. Member tab and hosted, same gate |
| Usage | Events ledger, paging | Usage events | Done | "renders healthy in both themes". Paging has no live check |

## Settings: links and other

| Domain | Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- | --- |
| Links | Route and gate | `/o/[id]/links` | Done | "links: create, find, open, edit and delete" |
| Links | First paint of the list the URL asks for | `prefetch.ts` | Done | `prefetch-reads.test.ts` |
| Links | List with paging, search and sort in the URL | Links | Done | "links: create, find, open, edit and delete" covers search. Paging and sort have no live check |
| Links | Favicon, owner, access, updated cells | Links | Unverified | No live check yet |
| Links | Row opens `sim/<name>` on the main app | Links | Done | "links: create, find, open, edit and delete" |
| Links | Row menu: Open, Copy link, Edit, Delete by `canEdit` | Links | Done | "links: create, find, open, edit and delete" |
| Links | Create and edit: variable default, normalized name, 409 on the field, access, Learn more | Links | Done | "links: create, find, open, edit and delete". 409 and Learn more have no live check |
| Links | `?create=<name>` deep link from an unknown `sim/<name>` | `app/sim/[[...path]]` | Done | "an unknown sim/ link opens the editor" |
| Links | Delete confirm with error | Links | Done | "links: create, find, open, edit and delete". The error path has no live check |
| Links | Install Sim for Chrome | Links | Unverified | No live check yet. Hosted only, same gate. Current staging has no shortcuts modal or bookmark export |
| Links | Copy or create from a chat source card | `source-card` | Open | Chat owner |
| White-labeling | Form, entitlement, upload, colors, links, save and discard, guard | White-labeling | Unverified | "white-labeling reports its entitlement" reads the entitlement; the form, upload and save have no live check |
| White-labeling | Applying the brand to the Platform | `BrandingProvider` | Hidden | The Platform's tokens differ from `--brand*`. Needs a token mapping |
| Unsaved changes | Link click, closing tab, browser Back and Forward | `settings-navigation-guard` | Unverified | No live check yet. The same hooks and dirty store as legacy; one dialog in `session-state/settings-leave-guard`. Not exercised in which seeds no draft on a paid plan |
## Settings: governance

Every API behind these sections keeps its own server gate; the navigation entry comes from `organization.settingsSections`.

| Domain | Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- | --- |
| Permission groups | List, search, count, Default tag, member and workspace summary, Review requests link | `ee/access-control/components/access-control.tsx` | Unverified | No live check yet |
| Permission groups | Create: name, description, default, workspaces, inline error; non-default needs a workspace | `access-control.tsx` | Done | "a permission group created in the form opens", "the permission editor reads". The inline error has no live check |
| Permission groups | Deep-linked detail, tab, search and status on the legacy URL keys, reset together | `group-detail.tsx`, `ee/access-control/search-params.ts` | Unverified | No live check yet |
| Permission groups | Name, description (100/500, required), save, discard, set-based dirty check, delete | `group-detail.tsx`, `ee/access-control/lib/editor.ts` | Unverified | "a permission group created in the form opens" reloads the detail and deletes it. Save, discard and limits have no live check |
| Permission groups | Default switch and workspace scope, optimistic with sequence guard and revert | `group-detail.tsx` | Unverified | No live check yet |
| Permission groups | Members: list, remove, add modal with search and select all, external excluded | `group-detail.tsx` | Unverified | No live check yet |
| Permission groups | Allowlist universe: includes viewer-gated blocks, excludes superseded blocks | `ee/access-control/lib/editor-registry.ts`, `lib/permission-groups/block-access.ts` | Done | "the permission editor reads the whole allowlist universe"; `group-detail.test.tsx` for the shared module |
| Permission groups | Providers tab, Agent default with validity, static and dynamic models, three-state editor, inheritance, bulk | `permission-rows.tsx`, `agent-default.tsx`, `ee/access-control/lib/editor.ts` | Unverified | No live check yet |
| Permission groups | Blocks tab: core and integrations, per-tool expand; rendered list hides viewer-gated rows | `permission-rows.tsx`, `GET /api/organizations/[id]/permission-groups/editor-catalog` | Unverified | No live check yet. A custom block appears on Platform in the org surface, where the legacy `/o` surface never hydrated them |
| Permission groups | Block colour tile | `permission-rows.tsx` | Hidden | Rows use the shared provider mark; a per-block colour would be a per-screen override |
| Permission groups | Platform tab: categories, inert rows, nested grids, project issue restrictions | `group-detail.tsx`, `project-issue-restrictions.tsx`, `hooks/queries/project-list.ts` | Unverified | No live check yet |
| Audit logs | Feed, paging, search in URL, type multi-select, time range with custom calendar | `ee/audit-logs/components/audit-logs.tsx` | Unverified | No live check yet |
| Audit logs | Fail-closed workspace scope, chip clears it, refresh repeats the gate | `ee/audit-logs/lib/scope.ts` | Done | "audit logs fail closed" |
| Audit logs | Export CSV, truncation notice, disabled unless the scope is answerable | `ee/audit-logs/lib/scope.ts`, `lib/core/utils/csv-download.ts` | Unverified | No live check yet |
| Audit logs | Entry detail and metadata rendering, all empty states | `ee/audit-logs/lib/format.ts` | Unverified | No live check yet |
| Sign-in | Plan gates, tabs with docs link, hidden tabs stay mounted | `ee/sso/components/sso-settings.tsx` | Unverified | No live check yet |
| Sign-in | Provider list as routing table, Primary tag, make primary, delete naming who signs in next | `ee/sso/lib/provider-form.ts` | Unverified | No live check yet |
| Sign-in | Add and edit form, OIDC and SAML, all fields and validation, attribute mapping, callback and entity values | `ee/sso/lib/provider-form.ts` | Done | `settings-b`; `sso-settings.test.tsx` for the shared module |
| Sign-in | Client secret write-only: masked fact, Replace, Keep saved, blank keeps the stored secret, no copy | `ee/sso/lib/provider-form.ts` | Done | "single sign-on never receives a stored client secret". No provider is seeded, so Replace and Keep saved have no live check |
| Sign-in | Password-manager decoy inputs and read-only-until-focus | `sso-provider-settings.tsx` | Hidden | Uses `autoComplete` off or `new-password` on the shared fields, which take no focus hooks or decoys |
| Sign-in | Require SSO: confirm on enable, explanation, off always available | `require-sso-section.tsx`, `ee/sso/lib/provider-form.ts` | Unverified | No live check yet |
| Domains | Add with Enter, status, host and TXT copy, verify, remove with SSO warning, all states | `verified-domains-section.tsx` | Unverified | No live check yet |
| Provisioning | Enable, base URL, status, provisioning rules, activity, reconcile | `ee/scim/components/scim-section.tsx` | Unverified | No live check yet |
| Provisioning | Tokens: issue with expiry, one-time secret through `CopyField`, revoke, two-token cap | `scim-section.tsx` | Unverified | No live check yet |
| Provisioning | Group mappings: add, remove, attention notices, name-match warning | `ee/scim/lib/group-mapping-view.ts` | Unverified | No live check yet |
| Security | Session policy: lifetime and idle bounds, save, discard, enterprise gate | `ee/session-policy/lib/policy-form.ts` | Done | "security validates session bounds" |
| Security | Sign out all members, current session excepted by the server | `session-policy-settings.tsx` | Unverified | "security validates session bounds" opens the confirmation; it does not revoke |
| Security | Outbound IPs with copy, blocked, pending and unconfigured copy, retry | `components/settings/organization-security.tsx` | Unverified | No live check yet |
| Data retention | Policy list, summaries, add override, remove with confirm, whole-document save | `ee/data-retention/lib/policy-draft.ts` | Unverified | No live check yet |
| Data retention | Log, soft delete and task periods, Inherit on overrides, clamped to the contract | `ee/data-retention/lib/policy-draft.ts` | Unverified | No live check yet |
| Data retention | PII stages, entity grid with search and language prune, custom patterns | `policy-draft.ts`, `lib/guardrails/custom-patterns.ts` | Done | "data retention keeps its bounds" covers custom patterns. The entity grid has no live check |
| Data drains | List, search, deep link holds first paint, states | `ee/data-drains/components/data-drains-settings.tsx` | Unverified | No live check yet |
| Data drains | Create with all eight destinations; credentials write-only | `ee/data-drains/destinations/specs.ts` | Unverified | "a data drain withholds Create" proves the guard and the masked secret field for one destination; no drain has been created |
| Data drains | Detail: enabled, Run now, Test connection, schedule, destination, runs, delete | `data-drain-detail.tsx` | Unverified | No live check yet |
| Settings | Unsaved-changes guard | `hooks/use-settings-unsaved-guard.ts` | Open | Every editor registers with the shared dirty store through `useSettingsUnsavedGuard`; one dialog covers them all, and the SCIM enable switch reads the shared navigation block. Not exercised in `settings-b.spec.ts` |

Status is one of:

- **Done**: works on live data. Proof quotes the title of a test in `checks/live/`, or names an integration or unit test.
- **Unverified**: built on live data, and no check exercises it. Reason says what is proved so far and what stands in the way. Never read this as working.
- **Legacy**: stays on the legacy surface and the Platform links out. Proof names the unmapped route in `lib/platform/routes.ts`.
- **Hidden**: Platform UI with no backend, hidden on live data. Reason names what a backend would need.
- **Open**: not built yet. Reason names the owner.

## Members

Every row runs on live data through `lib/data/members.ts`. Proof quotes a test in `checks/live/members.spec.ts`.

| Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- |
| Section access, aliases `organization` and `team` | `O/settings/[section]`, `O/settings/navigation.ts` | Unverified | No live check yet. Section gate from `settingsSections`; aliases resolved by `lib/platform/routes.ts` before arrival |
| Viewer role from the viewer's roster row, falling back to the server-read surface, never Better Auth's capped list | `TM/team-management.tsx` | Done | "plain member sees no controls" |
| Roster, name and email, avatar, joined date, directory deactivation, empty, loading and error with retry, prefetch for first paint | `organization-member-lists.tsx`, `settings-query-warmers.ts` | Done | "a role change persists", "a plain member sees no controls". Failure with retry has no live check |
| Search across every section in `?search=`, sections collapse, no-match copy | `organization-member-lists.tsx` | Done | "member search lives in the URL" |
| Change role, with row controls matching the server's guards | `organization-member-lists.tsx` | Done | "a role change persists" |
| Role, resend, revoke and workspace mutation failures reach the viewer. Legacy only logged them | `organization-member-lists.tsx` | Done, not copied | "a failed one is reported" for the role. Resend, revoke and workspace mutations have no live check |
| Remove member. Path parameter is the user id | `TM/team-management.tsx`, `remove-member-dialog.tsx` | Done | "removal holds on its disclosure" |
| Removal impact disclosure holds confirm on any refetch, cautions on a failed check | `TM/team-management.tsx`, `remove-member-dialog.tsx` | Done | "removal holds on its disclosure" |
| Leave organization, full navigation after | `TM/team-management.tsx` | Unverified | No live check yet. Destructive for the seeded admin, needs its own seed |
| Transfer ownership and leave, candidates admin first, only-member state, Stripe portal notice. Legacy labelled it "Transfer ownership" though it always leaves; the Platform label says so | `transfer-ownership-dialog.tsx` | Unverified | No live check yet. Needs its own seed |
| Manage credits, gated on hosted. Legacy offered it self-hosted, where the API answers 404, and showed no error | `manage-credits-modal.tsx` | Unverified | No live check yet. Load failure shows a retry |
| Seats: none with View plans, Team count with pending, Enterprise meter and over limit, error with retry | `team-seats-overview.tsx` | Unverified | No live check yet. Needs billing seed |
| Per-workspace sections, permission select, lock reason, remove from workspace. Legacy offered removal of the billed account, which the server refuses | `organization-member-lists.tsx`, `components/permissions/role-lock.tsx` | Unverified | No live check yet. Needs workspace seed |
| Pending invites: role, grant, resend, revoke | `organization-member-lists.tsx` | Done | "a pending invite resends and revokes". Role and grant edits have no live check |
| Invite from Members and the org menu, role choice, format and self rejection, advisory seat check, success summary | `invite-modal.tsx` | Done | "a partial invite failure" |
| Partial invite failure retains only the failed addresses, with reasons | `invite-modal.tsx` | Done | "a partial invite failure" |
| Invite's workspace picker and External membership | `invite-modal.tsx` | Legacy | Only offered from a workspace entry, and none exists on this surface |
| Invite acceptance | `app/invite/[id]` | Legacy | Stays at `/invite` by decision |
| My pending invitations | `pending-invitations/` | Legacy | Workspace header only; not on the organization surface today |
| No-organization recovery and create organization | `no-organization-view.tsx` | Legacy | Unreachable here: the surface requires membership |

## Requests

Every row runs on live data through `lib/data/requests/queries.ts`, with the legacy query parsers, so email links keep working.

| Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- |
| View switch, default review for administrators | `AR/access-requests-settings.tsx` | Done | "Requests opens for an administrator" |
| Legacy query parameters, including `view=admin` and `request-id` | `AR/search-params.ts`, `ee/access-requests/lib/navigation.ts` | Unverified | No live check yet. `requests-section.tsx` normalizes through the legacy function |
| My requests, paging, status, empty and error states | `AR/access-requests-settings.tsx` | Unverified | No live check yet |
| Browse access, search, available and pending states, paused notice | `AR/access-requests-settings.tsx` | Unverified | No live check yet |
| Request access dialog: reason, already allowed, paused, retry, view pending | `AR/request-access-action.tsx` | Unverified | No live check yet |
| Request details, withdraw | `AR/my-access-request-details.tsx` | Unverified | No live check yet |
| Allow requests toggle, failure reported | `AR/organization-access-requests.tsx` | Unverified | No live check yet |
| Review list: status filter, search, paging, count, empty copy | `AR/organization-access-requests.tsx` | Unverified | No live check yet |
| Review: preview, policy changes and details, credit limit, decline reason, `expectedFingerprint` on apply | `AR/access-request-review.tsx`, `AR/policy-changes.tsx` | Unverified | No live check yet. Description helpers shared through `ee/access-requests/lib/policy-description.ts` |
| Cross-surface prompts: `PermissionAccessBoundary`, `MemberLimitRequestAction` | `AR/permission-access-boundary.tsx` | Legacy | Read `workspaceId` from a workspace route; no such surface here |

`flows.spec.ts` opens the section and switches its view. Nothing else here is exercised: it needs a seeded requester, a governing permission group and a reviewer.

## People

Every row runs on live data through `lib/data/people.ts`. `/people` answers 404 in fixture and fixture-off modes.

| Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- |
| Page gate on `canBrowsePeople`, from `navFlags.people`. Legacy's page used the weaker flag check and rendered a refusal as a load error | `O/people/page.tsx`, `lib/people/feature-flag.ts` | Done, not copied | "a member withheld the directory" in `people.spec.ts` |
| Directory: windowed table, paging, profile links with the origin in the query, search in the URL, department filter with counts and server search, filter tag, loading, empty, no results, error and load-more failure | `O/people/people-directory.tsx` | Done | "the directory filters" in `people.spec.ts` |
| Identifiers: `memberId` is a directory id here, and `userId` can be null | `lib/api/contracts/people.ts` | Done | "the directory filters" |
| Org chart on a canvas: manager, focus, reports, zoom, pan and fit. The same views as `/o/[id]/people` since #9720, which replaced the fixed CSS layout | `O/people/chart-canvas.tsx` | Unverified | "the org chart opens" reaches the page and its refusal; no zone check draws the canvas. `scripts/test-people-e2e.ts` proves it embedded |
| Chart: reporting path, top-level teams, find a person, My position, report paging by viewport, keyboard focus restoration, empty state with CTAs, 404, refusal against transient, loading, five-minute refresh | `O/people/people-chart.tsx`, `chart-empty-state.tsx` | Unverified | No live check yet. "the org chart opens" covers 404; the rest by static reading |
| Profile: details, department link, Managed by, tenure, reports, View in org chart, Back preserving origin, 404, refusal against transient | `O/people/[memberId]/person.tsx` | Unverified | No live check yet. "the directory filters" covers Back; the rest by static reading |
| Edit profile, gated on admin and no directory source, manager search, suspended manager label, field errors | `O/people/[memberId]/person-modal.tsx` | Unverified | No live check yet |
| Import: sources, SCIM gate and readiness, token-safe mutation, file parse with its memory guard, template, preview, `previewDigest` apply, 409 returns to preview, dismiss locked in flight | `people-import-modal.tsx`, `import-source.tsx`, `read-sheet.ts` | Unverified | No live check yet. Needs provider or file seed |
| Directory sync: status with polling, state tag, progress, activity, connect, update, disconnect, run footer states, `?panel=sync`, load error, stays dismissable while a sync runs | `directory-sync-page.tsx`, `connect-modal.tsx` | Unverified | No live check yet. Needs provider seed |
| Benchmark | `O/benchmark` | Legacy | Stays legacy by decision |
## Shell

The shell lane's rows, one per row of its audit. `shell.spec` is `checks/live/shell.spec.ts`. They run in the `live` job against a real app and database.

| Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- |
| Bare `/o` resolves to the viewer's org home | `app/o/page.tsx` | Done | "signing in through the zone lands" |
| `/o` loading screen | `app/o/loading.tsx` | Unverified | No live check yet. Foundation: `(shell)/loading.tsx` |
| Signed-out redirect with `callbackUrl` | `O/layout.tsx` | Done | "signing in from a Platform link returns to the zone". The callback is the zone root, as on legacy: a deep link is not restored |
| Non-member denial page | `O/layout.tsx`, `organization-access-denied.tsx` | Unverified | No live check yet. Foundation: `shell-gate.tsx` |
| Surface unavailable redirect | `O/layout.tsx` | Unverified | No live check yet. Foundation: `hasOrganizationSurface` in `live-shell.tsx` |
| Org root redirect priority | `O/page.tsx` | Unverified | No live check yet. Foundation: `lib/data/landing.ts` |
| Home page gate | `O/home/page.tsx` | Done | "a member who cannot build lands on Search". `resolveHomeRedirect` in `live-home-route.tsx` |
| Error boundary with retry | `O/error.tsx` | Unverified | No live check yet. Foundation: `(shell)/error.tsx` |
| Not found page | `O/not-found.tsx` | Done | "A chat outside the viewer’s access is not found". It is a streamed 200, not a 404 status, under the shell's Suspense boundary |
| Server prefetch of chats, workspaces, profile | `O/prefetch.ts` | Unverified | No live check yet. Foundation: `lib/data/prefetch-shell.ts` |
| Org surface context | `organization-provider.tsx` | Done | "signing in through the zone lands" |
| Deployment shape seeding | `organization-provider.tsx` | Unverified | No live check yet. Foundation: `useSeedDeploymentShape` in `lib/data/organization.tsx` |
| Live chat status over SSE | `use-mothership-chat-events.ts` | Unverified | No live check yet. `LiveChatEvents` subscribes in `lib/data/providers.tsx`; the list reads `isActive` and `isUnread` |
| Socket connection | `organization-provider.tsx` | Open | Chat owner decides. No shell view consumes it |
| Source history provider | `organization-provider.tsx` | Open | Chat owner |
| Runtime feature flags | `O/layout.tsx` | Done | "navigation lists what the surface grants" |
| Sim link scope and global create form | `O/layout.tsx` | Open | Settings owner: Links is a Settings section |
| Impersonation banner | `impersonation-banner.tsx` | Unverified | No live check yet. Foundation: `session-state.tsx` |
| Session expired takeover | `session-expired.tsx` | Unverified | No live check yet. Foundation: `session-state.tsx` |
| Stale session cookie: sign out before login instead of looping | `app/workspace/page.tsx` | Unverified | No live check yet. `live-shell/stale-session.tsx` |
| Workspace entry: last workspace, `redirect_workflow`, `redirect`, first workspace, blocked policy | `app/workspace/page.tsx` | Unverified | No live check yet. `(shell)/workspace/page.tsx`, `lib/data/workspace-entry.ts` |
| Workspace error, not found and access denied | `[workspaceId]/error.tsx`, `not-found.tsx`, `workspace-access-denied.tsx` | Unverified | No live check yet. `workspace/[workspaceId]/error.tsx` and `not-found.tsx`; an inaccessible workspace reads as not found |
| Unsaved settings guard on links and sign out | `settings-navigation-guard.tsx`, `settings-guarded-link.tsx` | Unverified | No live check yet. `lib/data/settings-guard`, `settings-leave-guard.tsx`, `requestLeave` |
| Unsaved settings guard on browser back and forward | `use-settings-browser-navigation.ts` | Unverified | No live check yet. `lib/data/settings-guard`, the same hook as legacy |
| Branded metadata and whitelabel theme | `app/layout.tsx` | Open | Settings owner, with White-labeling |
| Analytics and telemetry, including `docs_opened` and `slack_community_opened` | `app/layout.tsx`, `organization-sidebar.tsx` | Open | No PostHog provider is mounted here, so the help menu sends no events |
| Error and success toasts | `@sim/emcn` `toast` | Unverified | No live check yet. Foundation: `shared/toast.ts`, `useToastNotices` |
| Collapse toggle | `organization-sidebar.tsx` | Done | "Mod+B collapses the sidebar" |
| Collapse persisted, no flash | `stores/sidebar/store.ts` | Done | "Mod+B collapses the sidebar" |
| Collapsed icon rail with flyouts | `organization-sidebar.tsx` | Hidden | Product decision: the Platform collapses to its opener control, with no rail |
| Drag to resize | `useSidebarResize` | Hidden | Product decision: the Platform sidebar has one width |
| Desktop hover peek | `useSidebarPeek` | Hidden | Product decision: follows the rail decision |
| Mobile navigation drawer | `workspace-chrome.tsx` | Unverified | No live check yet. Existing `platform-shell.tsx` drawer; `checks/ts` |
| Phone viewport containment | `workspace-viewport.tsx` | Open | Shell owner: needs a device check, and none has been possible yet. The shell uses `100dvh` |
| Desktop titlebar insets | `workspace-chrome.tsx` | Unverified | No live check yet. Existing `desktop-host.tsx` |
| Desktop menu commands | `workspace-chrome.tsx` | Unverified | No live check yet. `useDesktopCommands` in `desktop-host.tsx` |
| `Mod+B` toggles the sidebar | `commands.ts` | Done | "Mod+B collapses the sidebar" |
| Global command registry semantics | `global-commands-provider.tsx` | Unverified | No live check yet. Editable guard ported for `Mod+B`. The Platform has two commands and nothing claims `Mod+B` through `data-owned-shortcuts`, so no registry |
| `Mod+K` palette | Platform only | Done | "Mod+K opens the palette" |
| Home, Search, People, Integrations, Benchmark entries | `navigation.ts` | Done | "navigation lists what the surface grants". Integrations links to Emir's empty live page: see Integrations |
| Sim Links entry | `navigation.ts` | Unverified | No live check yet. Settings section `links`, gated by `navFlags.simLinks` |
| Nav right click: new tab, copy link | `organization-sidebar.tsx` | Done | "navigation lists what the surface grants" |
| Active item highlighting | `organization-sidebar.tsx` | Unverified | No live check yet. Existing `sidebar.tsx` |
| Settings rail replaces app rail | `organization-sidebar.tsx` | Unverified | No live check yet. Existing `sidebar.tsx` |
| Settings nav per role and plan | `organization-settings-sidebar.tsx` | Unverified | No live check yet. Foundation: `settings-navigation/destinations.ts` |
| Leave settings, return to prior page | `settings-return.ts` | Unverified | No live check yet. `settingsReturn` in `lib/data/shell-actions.ts` |
| Org chip with logo or initial | `organization-header.tsx` | Unverified | No live check yet. `organization-menu.tsx` |
| Collapsed chip as expand control | `organization-header.tsx` | Hidden | Product decision: the opener control does this, with no rail to hold a chip |
| Member count | `organization-header.tsx` | Unverified | No live check yet. Existing `organization-menu.tsx` |
| Change logo | `organization-header.tsx` | Unverified | No live check yet. `organization-menu.tsx`, admin only |
| Rename inline | `organization-header.tsx` | Done | "an organization admin can rename", "a member sees no identity controls" |
| Settings entry | `organization-header.tsx` | Unverified | No live check yet. Existing `organization-menu.tsx` |
| Invite entry | `organization-header.tsx` | Done | "a member sees no identity controls" |
| Invite form | `invite-modal.tsx` | Unverified | No live check yet. `_components/invite-modal/invite-modal.tsx` |
| Workspace list, pinned then by visits | `use-organization-workspaces.ts` | Done | "a workspace pins and renames" |
| Workspace logo tile | `workspace-list.tsx` | Hidden | Design contract: workspace names are text-only |
| No workspaces yet, silent while loading, retry on failure | `workspace-list.tsx` | Unverified | No live check yet. `section-status.tsx` |
| See more and See less | `workspace-list.tsx` | Unverified | No live check yet. `workspaces-section.tsx` |
| Switch workspace | `workspace-list.tsx` | Done | "creating a workspace opens it" |
| Row options and right click | `workspace-list.tsx` | Unverified | No live check yet. `workspaces-section.tsx` |
| Open in new tab | `workspace-list.tsx` | Unverified | No live check yet. `row-links.ts` |
| Rename | `workspace-list.tsx` | Done | "a workspace pins and renames". Admin only |
| Pin and unpin | `workspace-list.tsx` | Done | "a workspace pins and renames" |
| New workspace button with disabled reason | `workspaces-section.tsx` | Unverified | No live check yet. `workspaces-section.tsx` |
| Create workspace, then enter it | `create-workspace-modal.tsx` | Done | "creating a workspace opens it" |
| Section open and closed | `sidebar-section.tsx` | Unverified | No live check yet. Existing `sidebar-layout.tsx` |
| Sort workspaces | None | Hidden | See the Shell rows above |
| Chats section visibility | `organization-sidebar.tsx` | Unverified | No live check yet. `chatsAvailable` from `canListOrganizationChats` |
| Chat list | `use-organization-chats.ts` | Done | "a chat renames and deletes" |
| Mode-aware link | `use-organization-chats.ts` | Done | "an unread chat needs attention" opens an Assistant chat under Search |
| Status dot and pin glyph | `chats-section.tsx` | Unverified | No live check yet. `chatStatus` in `chats-section.tsx`, through Chip's `status` slot, which keeps it beside the always-shown row action on touch |
| No chats yet, silent while loading, retry on failure | `chats-section.tsx` | Unverified | No live check yet. `section-status.tsx` |
| Row options and right click | `use-organization-chat-actions.ts` | Done | "a chat renames and deletes" |
| Shift multi-select, background click clears | `use-chat-selection.ts` | Unverified | No live check yet. Local to `chats-section.tsx` |
| Rename | `use-organization-chat-actions.ts` | Done | "a chat renames and deletes" |
| Pin and unpin | `use-organization-chat-actions.ts` | Done | "a chat pins and marks unread" |
| Mark read and unread | `use-organization-chat-actions.ts` | Done | "a chat pins and marks unread" |
| Open in new tab, copy link | `use-organization-chat-actions.ts` | Unverified | No live check yet. `row-links.ts` |
| Delete one or many, partial failure, redirect if current | `use-organization-chat-actions.ts` | Done | "a chat renames and deletes" for one. Bulk and partial failure have no live check |
| Prefetch chat on hover | `chat-navigation-link.tsx` | Unverified | No live check yet. `lib/data/chat-list.ts`, on pointer dwell only. Legacy also reads on focus and press |
| Sort chats by name | None | Unverified | No live check yet. Platform only, session scoped, keeps pinned first |
| Account chip | `sidebar-footer.tsx` | Unverified | No live check yet. `account-menu.tsx`. Empty until the profile arrives, with no skeleton |
| Account menu Settings | `sidebar-footer.tsx` | Unverified | No live check yet. `account-menu.tsx` |
| Sign out | `sidebar-footer.tsx`, `lib/auth/sign-out.ts` | Done | "sign out ends the session" |
| Docs | `sidebar-footer.tsx` | Unverified | No live check yet. `help-menu.tsx`, `DOCS_URL`. Event: see analytics |
| Join Slack | `sidebar-footer.tsx` | Unverified | No live check yet. `help-menu.tsx`. Event: see analytics |
| Contact support form with images | `help-modal.tsx` | Unverified | No live check yet. `support-modal.tsx`, shared `lib/help/request.ts` |
| Desktop update item | `sidebar-footer.tsx` | Unverified | No live check yet. `lib/data/shell-actions.ts`. The help trigger keeps its glyph, without the legacy update indicator |
| Download apps | Platform only | Unverified | No live check yet. Hosted and outside the desktop app |
| Changelog | Platform only | Unverified | No live check yet. Hosted only, on the deployment's own origin |
| Inbox panel | None | Hidden | See the Shell rows above |
| Tray history | None | Hidden | See the Shell rows above |
| Local action notice with Undo | None | Unverified | No live check yet. Existing `notification-tray.tsx` |
| Recents | None | Hidden | See the Shell rows above |
## Home

| Domain | Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- | --- |
| Home | Personal greeting | `app/o/[id]/components/organization-conversation.tsx` | Done | "greets the member by first name" |
| Home | Gate for members who cannot build | `app/o/[id]/home/home-redirect.ts` | Done | "a member who cannot build lands on Search" |
| Home | Email widget: read the viewer's mail | None; Platform only | Done | `home-widgets.integration.ts` proves the read with the provider stubbed; "a connected member reads their mail" proves the widget with the read stubbed in the browser. No real Google or Microsoft mailbox has been read |
| Home | Calendar widget: read a day of meetings | None; Platform only | Done | `home-widgets.integration.ts` proves the read with the provider stubbed; "keeps a chosen day" proves `?day=` and reload with the read stubbed in the browser. No real calendar has been read. All-day and overlapping lanes: `home-model.test.ts` |
| Home | Connect, reconnect, disconnect from a widget | Integrations page | Unverified | Starting the flow is proved by "connecting Gmail starts the provider’s real authorization", and removal by "disconnecting removes the account". Completing OAuth needs a real Google or Microsoft consent, so a finished connection is not proved |
| Home | Widget offered only when the organization offers it | Member inventory | Done | "a widget’s connect options are exactly what the organization offers"; `home-model.test.ts` |
| Home | Widget states: loading, not offered, not connected, reconnect, retry, empty, partial | None; Platform only | Done | `home-model.test.ts`; "a failed read offers a retry", "an account Google stopped honoring", "with an empty mailbox" |
| Home | Mail when the organization restricts that source's content | Search source policy | Hidden | A source in scoped mode (selected labels, excluded categories) cannot be read directly: `requireAssistantProviderAccess` refuses it, as it refuses the assistant's direct tools. The widget reads as not offered. Honoring the scope needs the Search policy verifier over a mailbox listing |
| Home | Gmail thread open target | None; Platform only | Done | "a connected member reads their mail" |
| Home | Calendars other than the primary one | None; Platform only | Hidden | The widget reads each account's primary or default calendar. Others need a calendar picker and a place to store the choice |
| Home | Activity chart: Tasks run | `ee/organization-usage` | Done | "a member who cannot read the activity summary". The seeded run shows real counts in the routes screenshots |
| Home | Activity chart for ordinary members | None; Platform only | Hidden | Needs a member-scoped activity read. Organization-wide counts are not theirs to see |
| Home | Activity chart: Searches | None; Platform only | Hidden | No truthful source: `organization_search_history` keeps 20 rolling entries per person, assistant chats count conversations rather than searches, and `organization_search_mcp_invocation` covers MCP alone. Needs a search event or counter table. Search mode shows no chart and drops it from Customize |
| Home | Recents | None; Platform only | Done | "Recents list the viewer’s real history" |
| Home | Recents the panel shows for files and workspaces | None; Platform only | Hidden | A per-user recent destinations store |
| Home | Needs your attention | None; Platform only | Done | "an unread chat needs attention", "an account Google stopped honoring". A failed source has no live check |
| Home | Cross-chat approvals in Needs your attention | None; Platform only | Hidden | Pending tool permissions and assistant reviews are listed per chat. Needs a member-scoped list across chats |
| Home | Customize Home | None; Platform only | Open | Hide and Undo work for the session; a reload restores every widget. `stores/organization-home/store.ts` already persists the choice per viewer in the browser with no migration, and `embedded/` reads it. The zone keeps it in `interface-preferences.tsx`, which is UI state and its owner's move |
| Home | Get started checklist | `app/o/[id]/home/components/get-started/get-started.tsx` | Done | "Search mode on Home offers Get started". Completing each step has no live check |
| Home | Suggested action rows and Connect from a suggestion | `suggested-actions.tsx` | Open | Chat lane. Needs the block template catalog (337-file closure, banned by the seam) behind a route, and a way to hand a prompt to the composer draft. Recents hold that slot on Platform |
| Home | Plan toggle, composer handoff and server chat id | `organization-conversation.tsx` | Open | Chat lane owns `home-composer` |
| Home | Workspace status read stays bounded under thousands of time pauses: only the asked workspaces' pauses are read, stopping at the first waiting on a person | `lib/organizations/home/workspace-activity.ts` | Done | `workspace-activity.integration.ts` measures the real plan on real PostgreSQL. No index is needed; a workspace with no match still reads every one of its live pauses |

## Workspace pages

The workspace's Dashboard, Issues, Changelog and Logs are Platform pages with fixture data. Each view takes `data` and a named `actions` interface, so a live adapter in `lib/data` supplies the same props. Until one exists, a live workspace keeps its legacy page. Tables, Files, Knowledge bases and Workflows are live-only ports of the legacy pages; a live workspace opens on Workflows. Their rows were checked by hand against the live stack and legacy on 2026-11-08 and have no committed live check yet.

| Domain | Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- | --- |
| Workspace | Dashboard: period, section choices, self-refresh with its last update | `app/workspace/[workspaceId]/dashboards/page.tsx` | Legacy | `redirectWorkspaceTabToLegacy` sends a live workspace to its legacy dashboard. Adapter: `hooks/queries/dashboards.ts` over `/api/workspaces/[id]/dashboard`, mapped onto `DashboardData` |
| Workspace | Changelog feed and change details | `app/workspace/[workspaceId]/changelog/changelog.tsx` | Legacy | Live redirects to the legacy changelog, a change's details to its list. Adapter: `hooks/queries/changelog.ts` over `lib/api/contracts/changelog.ts`, mapped onto `ChangelogData` and `ChangelogDetail` |
| Workspace | Run list, filters, sort, new runs joining on refresh, run details and trace | `app/workspace/[workspaceId]/logs/logs.tsx` | Legacy | Live redirects to the legacy logs, a run to its `executionId`. Adapter: `hooks/queries/logs.ts` over `lib/api/contracts/logs.ts`, mapped onto `RunsData` and `RunDetail`; usage reads in Compute Units from the persisted cost. Each adapter refetches in the background and reports its last update |
| Workspace | Issues: list, details, decisions | None; Platform only | Hidden | No backend exists. Its live routes answer 404, and live workspaces hide its tab, so no live page links to it |
| Workspace | Breadcrumb folder traversal, collapsed past four crumbs, drop onto an ancestor to move | Legacy folder sidebar and resource headers | Unverified | Checked by hand on Tables, Files, Knowledge bases and Workflows. `@sim/emcn/breadcrumbs` |
| Workspace | Pin and unpin tables, files, knowledge bases, workflows and folders | `hooks/queries/pinned-items.ts` | Unverified | Checked by hand. Pinned rows sort first |
| Workspace | Tables list: search, filters, sort, folders, create at the top level, rename, move, delete | `app/workspace/[workspaceId]/tables/` | Unverified | Checked by hand |
| Workspace | Table grid: scrolling every row, cell editing, copy and paste, insert above and below, columns (every type, insert, pin, resize, reorder, hide, delete), filter, sort, find, Export CSV, row modal, Table Security, live updates | `tables/[tableId]/` | Unverified | Checked by hand, including a 51k-row table and two pages editing at once |
| Workspace | Table workflow and enrichment columns: add, map inputs, run, stop, view execution | `tables/[tableId]/` | Unverified | Checked by hand. Enrichments stop at missing hosted provider keys locally |
| Workspace | Table Import CSV and table views | `tables/[tableId]/` | Hidden | Removed by product direction |
| Workspace | Files: new file and folder, upload files and folders, unzip, download, move, rename, share, delete | `app/workspace/[workspaceId]/files/` | Unverified | Checked by hand |
| Workspace | File viewer and editors for every supported type, with per-file actions | `files/components/file-viewer/` | Unverified | Checked by hand. Collaborative markdown and the save-conflict notice need a calmer server for a second check |
| Workspace | Knowledge bases: create, edit, delete, tags, documents (upload, tags, enable, retry, delete), chunks | `app/workspace/[workspaceId]/knowledge/` | Unverified | Checked by hand |
| Workspace | Knowledge connectors: add, configure, access, sync, pause, edit, remove, in a rail and modal | `knowledge/[id]/components/connectors-section/` | Unverified | Checked by hand. The OAuth round trip from the zone needs `TRUSTED_ORIGINS` to include the zone in development |
| Workspace | Workflows list, folders and the editor canvas: drag from the toolbar, connect, loops and parallels with nesting, undo and redo, copy and paste, auto layout, search and replace | `app/workspace/[workspaceId]/w/` | Unverified | Checked by hand |
| Workspace | Deploy, redeploy, undeploy, roll back, rename versions, version descriptions, compare versions, API, chat and MCP deployment | `w/[workflowId]/components/panel/components/deploy/` | Unverified | Checked by hand |
| Workspace | Terminal and workflow variables | `w/[workflowId]/components/terminal/`, `components/variables/` | Unverified | Checked by hand. Variables moved from a floating window into the right panel |
| Workspace | Live workflow view in the deploy modal, API language examples, editor connections panel, canvas error notifications, panel and floating chat, floating variables | `w/[workflowId]/` | Hidden | Removed by product direction |
| Workspace | Tests list, Run all, test details and run picker | `app/workspace/[workspaceId]/tests/` | Unverified | No live check yet. Behind `workflow-tests` |
| Workspace | Test source edited beside its results; preview of the exact version a test ran against | `tests/components/test-dashboard.tsx` | Open | Edit opens the file in Files and ran-against rows open the current workflow: the file viewer and canvas preview are route-owned and need promoting first |
| Workspace | Workspace settings tab | `app/workspace/[workspaceId]/settings/` | Legacy | The tab exists and is empty by product direction; settings stay on the legacy workspace |

## Zone

| Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- |
| Legacy URLs land on their Platform routes, query kept | `lib/platform/routes.ts` | Done | "lands on" |
| A client navigation into a mapped route reaches the Platform | `platform-route-guard.tsx` | Done | "a client navigation into a mapped legacy route" |
| An unmapped route stays legacy; a forged header moves nobody | `proxy.ts` | Done | "a route with no Platform counterpart stays legacy", "a forged legacy URL header" |
| Security headers and noindex on zone pages, assets under the base path | `platform/proxy.ts` | Done | "zone pages carry the security headers" |
| No uncaught error, hydration mismatch, CSP block or 5xx on any route, in both themes at both widths | None; Platform only | Done | "renders healthy in both themes", one per route in `checks/live/routes.spec.ts` |
| Flag off, zone built: `/o` renders legacy with no redirect, `/org` pages are absent, the bare `/org` leads back to `/o` | `layout.tsx`, `live-shell.tsx`, `lib/data/landing.ts` | Done | "stays on the main app with no redirect", "/org is absent", "the bare /org has nothing to show", run with the flag off |
| Zone not built, flag on: `/o` renders legacy with no redirect, `/org` is absent | `next.config.ts` | Done | "/org is absent", in the `live (flag-off)` job |
| Zone down or answering 5xx with the flag on: a legacy URL renders on the main app, a Platform page returns there, an open tab's client navigation is sent back, sign-in lands there | `proxy.ts`, `lib/platform/zone-availability.ts` | Done | "with the zone unavailable", run with the process gone and with every page answering 503; `proxy.test.ts` for each way a zone can fail. A deep link comes back to the organization's home, not to its own page |
| A zone that recovers takes its organizations back | `lib/platform/zone-availability.ts` | Done | "a zone that comes back takes its organizations back" |
| Per-organization rollout: `platform-org-ui` reaches a targeted organization by id and no other, on the same deployment, through the real AppConfig client against a fixture of its service | `lib/platform/rollout.ts`, `lib/core/config/feature-flags.ts` | Done | "a targeted organization is handed to the Platform", "an organization outside the rollout stays on /o". No real AppConfig deployment has been read. Each route bundle polls on its own clock, so a change can reach the surface API and `/o` up to a poll apart, and until then `/o` can hand off to a zone that answers 404 |
| A rollback under an open tab: a client navigation keeps working, because the rollout gate lives in a layout that does not re-render, and a reload's 404 offers a way off the zone | `live-shell.tsx`, `lib/data/landing.ts` | Done | "a rollback under an open tab"; `landing.test.ts` for the root's decision. The 404's home button used to loop back to it |
| Self-hosted, no zone, no flag: boots, `/o` is served by the main app, `/org` is absent | `next.config.ts`, `lib/platform/rollout.ts` | Done | "a self-hosted deployment with no zone boots", "a self-hosted organization is served by the main app", "a self-hosted deployment has no /org", in the `live (flag-off)` job |
| A production zone behind a base path with no API origin, or on fixtures, refuses to start | `instrumentation.ts`, `lib/data/mode.ts` | Done | "a production zone with no API origin refuses to start", "a production zone on fixtures refuses to start", "a production zone with an API origin starts", each a real `next start` of the build. `lib/data/startup.ts` exits, because Next only logs a failed `register()` and answers 500 |
