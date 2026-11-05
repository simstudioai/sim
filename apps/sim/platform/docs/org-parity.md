# Organization parity ledger

One row per capability of the legacy organization surface. Every capability is either done with a check that proves it, or recorded here with the reason it is not. Nothing is silently dropped.

| Domain | Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- | --- |
| Shell | Inbox panel | None; Platform only | Hidden | A per-user item feed with read state, its contract and publishers |
| Shell | Notification tray history | None; Platform only | Hidden | The same feed. Local notices and hook toasts still use the tray |
| Shell | Recents on Home and in the chat panel | None; Platform only | Hidden | A per-user recent destinations store. Only fixtures supply rows, so live data renders none |
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

## Shell

The shell lane's rows, one per row of its audit. `shell.spec` is `checks/live/shell.spec.ts`. Those specs need a real app and database and have not been run yet. "Unproved" means built on live data with no spec covering it.

| Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- |
| Bare `/o` resolves to the viewer's org home | `app/o/page.tsx` | Done | Foundation: `lib/data/landing.ts`; `shell.spec` sign-in landing |
| `/o` loading screen | `app/o/loading.tsx` | Done | Foundation: `(shell)/loading.tsx`. Unproved |
| Signed-out redirect with `callbackUrl` | `O/layout.tsx` | Done | Foundation: `live-shell.tsx`; `shell.spec` sign-in landing |
| Non-member denial page | `O/layout.tsx`, `organization-access-denied.tsx` | Done | Foundation: `shell-gate.tsx`. Unproved |
| Surface unavailable redirect | `O/layout.tsx` | Done | Foundation: `hasOrganizationSurface` in `live-shell.tsx`. Unproved |
| Org root redirect priority | `O/page.tsx` | Done | Foundation: `lib/data/landing.ts`. Unproved |
| Home page gate | `O/home/page.tsx` | Open | Home owner |
| Error boundary with retry | `O/error.tsx` | Done | Foundation: `(shell)/error.tsx`. Unproved |
| Not found page | `O/not-found.tsx` | Done | Foundation: `(shell)/not-found.tsx`. Unproved |
| Server prefetch of chats, workspaces, profile | `O/prefetch.ts` | Done | Foundation: `lib/data/prefetch.ts`. Unproved |
| Org surface context | `organization-provider.tsx` | Done | Foundation: `lib/data/organization.tsx` |
| Deployment shape seeding | `organization-provider.tsx` | Done | Foundation: `useSeedDeploymentShape` in `lib/data/organization.tsx` |
| Live chat status over SSE | `use-mothership-chat-events.ts` | Open | Chat owner: the list reads `isActive` and `isUnread`, but nothing here subscribes to the events route yet |
| Socket connection | `organization-provider.tsx` | Open | Chat owner decides. No shell view consumes it |
| Source history provider | `organization-provider.tsx` | Open | Chat owner |
| Runtime feature flags | `O/layout.tsx` | Done | Foundation: `featureFlags` on the surface |
| Sim link scope and global create form | `O/layout.tsx` | Open | Settings owner: Links is a Settings section |
| Impersonation banner | `impersonation-banner.tsx` | Done | Foundation: `session-state.tsx`. Unproved |
| Session expired takeover | `session-expired.tsx` | Done | Foundation: `session-state.tsx`. Unproved |
| Unsaved settings guard on links and sign out | `settings-navigation-guard.tsx`, `settings-guarded-link.tsx` | Done | `lib/data/shell-guard.ts`, `settings-leave-guard.tsx`, `requestLeave`. Unproved until a Settings editor registers a guard |
| Unsaved settings guard on browser back and forward | `use-settings-browser-navigation.ts` | Open | Settings owner: it lives in a settings component the seam cannot import |
| Branded metadata and whitelabel theme | `app/layout.tsx` | Open | Settings owner, with White-labeling |
| Analytics and telemetry, including `docs_opened` and `slack_community_opened` | `app/layout.tsx`, `organization-sidebar.tsx` | Open | No PostHog provider is mounted here. `ShellHelp.onOpenDocumentation` and `onOpenSlack` are the seam for the events |
| Error and success toasts | `@sim/emcn` `toast` | Done | Foundation: `lib/data/toast.ts`, `useToastNotices`. Unproved |
| Collapse toggle | `organization-sidebar.tsx` | Done | `platform-shell.tsx`. Unproved |
| Collapse persisted, no flash | `stores/sidebar/store.ts` | Done | `sidebar_collapsed` read in `live-shell.tsx`, written in `sidebar-layout.tsx`. Unproved |
| Collapsed icon rail with flyouts | `organization-sidebar.tsx` | Hidden | Product decision: the Platform collapses to its opener control, with no rail |
| Drag to resize | `useSidebarResize` | Hidden | Product decision: the Platform sidebar has one width |
| Desktop hover peek | `useSidebarPeek` | Hidden | Product decision: follows the rail decision |
| Mobile navigation drawer | `workspace-chrome.tsx` | Done | Existing `platform-shell.tsx` drawer; `checks/shell.spec.ts` |
| Phone viewport containment | `workspace-viewport.tsx` | Open | Shell owner: needs a device check, and none has been possible yet. The shell uses `100dvh` |
| Desktop titlebar insets | `workspace-chrome.tsx` | Done | Existing `desktop-host.tsx` |
| Desktop menu commands | `workspace-chrome.tsx` | Done | `useDesktopCommands` in `desktop-host.tsx`. Unproved |
| `Mod+B` toggles the sidebar | `commands.ts` | Done | `platform-shell.tsx`, skips editable fields. Unproved |
| Global command registry semantics | `global-commands-provider.tsx` | Done | Editable guard and `data-owned-shortcuts` ported for `Mod+B`. The Platform has two commands, so no registry |
| `Mod+K` palette | Platform only | Done | `command-menu.tsx`: gated destinations, real workspace and chat links. Unproved |
| Home, Search, People, Integrations, Benchmark entries | `navigation.ts` | Done | `destinations.ts`; `shell.spec` navigation |
| Sim Links entry | `navigation.ts` | Done | Settings section `links`, gated by `navFlags.simLinks` |
| Nav right click: new tab, copy link | `organization-sidebar.tsx` | Done | `ContextActionMenu` in `sidebar.tsx`; `shell.spec` navigation |
| Active item highlighting | `organization-sidebar.tsx` | Done | Existing `sidebar.tsx` |
| Settings rail replaces app rail | `organization-sidebar.tsx` | Done | Existing `sidebar.tsx` |
| Settings nav per role and plan | `organization-settings-sidebar.tsx` | Done | Foundation: `settings-navigation/destinations.ts` |
| Leave settings, return to prior page | `settings-return.ts` | Done | `settingsReturn` in `lib/data/shell-actions.ts`. Unproved |
| Org chip with logo or initial | `organization-header.tsx` | Done | `organization-menu.tsx`. Unproved |
| Collapsed chip as expand control | `organization-header.tsx` | Hidden | Product decision: the opener control does this, with no rail to hold a chip |
| Member count | `organization-header.tsx` | Done | Existing `organization-menu.tsx` |
| Change logo | `organization-header.tsx` | Done | `organization-menu.tsx`, admin only. Unproved |
| Rename inline | `organization-header.tsx` | Done | `organization-menu.tsx`; `shell.spec` rename, and the member refusal |
| Settings entry | `organization-header.tsx` | Done | Existing `organization-menu.tsx` |
| Invite entry | `organization-header.tsx` | Done | Gated on `canInviteMembers`; `shell.spec` member |
| Invite form | `invite-modal.tsx` | Open | People owner: replaces the `invite-modal/` placeholder |
| Workspace list, pinned then by visits | `use-organization-workspaces.ts` | Done | `lib/data/shell.ts`, `workspaces-section.tsx`. Unproved |
| Workspace logo tile | `workspace-list.tsx` | Hidden | Design contract: workspace names are text-only |
| No workspaces yet, silent while loading, retry on failure | `workspace-list.tsx` | Done | `section-status.tsx`. Unproved |
| See more and See less | `workspace-list.tsx` | Done | `workspaces-section.tsx`. Unproved |
| Switch workspace | `workspace-list.tsx` | Done | Full navigation to `/workspace/{id}`; `shell.spec` create |
| Row options and right click | `workspace-list.tsx` | Done | `workspaces-section.tsx`. Unproved |
| Open in new tab | `workspace-list.tsx` | Done | `row-links.ts`. Unproved |
| Rename | `workspace-list.tsx` | Done | Admin only. A dialog here, as the design contract asks for forms. Unproved |
| Pin and unpin | `workspace-list.tsx` | Done | `lib/data/workspaces.ts`. Unproved |
| New workspace button with disabled reason | `workspaces-section.tsx` | Done | `workspaces-section.tsx`. Unproved |
| Create workspace, then enter it | `create-workspace-modal.tsx` | Done | `shell.spec` create |
| Section open and closed | `sidebar-section.tsx` | Done | Existing `sidebar-layout.tsx` |
| Sort workspaces | None | Hidden | See the Shell rows above |
| Chats section visibility | `organization-sidebar.tsx` | Done | `chatsAvailable` from `canListOrganizationChats`. Unproved |
| Chat list | `use-organization-chats.ts` | Done | Foundation: `lib/data/shell.ts`; `shell.spec` chat |
| Mode-aware link | `use-organization-chats.ts` | Done | Assistant chats open under Search on the legacy surface. Unproved |
| Status dot and pin glyph | `chats-section.tsx` | Done | `ChatIndicator` in `chats-section.tsx`. Unproved |
| No chats yet, silent while loading, retry on failure | `chats-section.tsx` | Done | `section-status.tsx`. Unproved |
| Row options and right click | `use-organization-chat-actions.ts` | Done | `shell.spec` chat |
| Shift multi-select, background click clears | `use-chat-selection.ts` | Done | Local to `chats-section.tsx`. Unproved |
| Rename | `use-organization-chat-actions.ts` | Done | `lib/data/chat-list.ts`, a dialog here; `shell.spec` chat |
| Pin and unpin | `use-organization-chat-actions.ts` | Done | `lib/data/chat-list.ts`. Unproved |
| Mark read and unread | `use-organization-chat-actions.ts` | Done | `lib/data/chat-list.ts`. Unproved |
| Open in new tab, copy link | `use-organization-chat-actions.ts` | Done | `row-links.ts`. Unproved |
| Delete one or many, partial failure, redirect if current | `use-organization-chat-actions.ts` | Done | `confirmRemoval` in `chats-section.tsx`; `shell.spec` chat for one. Bulk and partial failure unproved. Labelled Delete, as it moves to Recently deleted |
| Prefetch chat on hover | `chat-navigation-link.tsx` | Done | `lib/data/chat-list.ts`, on pointer dwell only. Legacy also reads on focus and press. Unproved |
| Sort chats by name | None | Done | Platform only, session scoped, keeps pinned first |
| Account chip | `sidebar-footer.tsx` | Done | `account-menu.tsx`. Empty until the profile arrives, with no skeleton. Unproved |
| Account menu Settings | `sidebar-footer.tsx` | Done | `account-menu.tsx`. Unproved |
| Sign out | `sidebar-footer.tsx`, `lib/auth/sign-out.ts` | Done | `shell.spec` sign out. A failed sign-out stays put with a notice, where legacy goes to login and bounces back |
| Docs | `sidebar-footer.tsx` | Done | `help-menu.tsx`, `DOCS_URL`. Event: see analytics |
| Join Slack | `sidebar-footer.tsx` | Done | `help-menu.tsx`. Event: see analytics |
| Contact support form with images | `help-modal.tsx` | Done | `support-modal.tsx`, shared `lib/help/request.ts`. Unproved |
| Desktop update item | `sidebar-footer.tsx` | Done | `lib/data/shell-actions.ts`. The help trigger keeps its glyph, without the legacy update indicator. Unproved |
| Download apps | Platform only | Done | Hosted and outside the desktop app |
| Changelog | Platform only | Done | Hosted only, on the deployment's own origin |
| Inbox panel | None | Hidden | See the Shell rows above |
| Tray history | None | Hidden | See the Shell rows above |
| Local action notice with Undo | None | Done | Existing `notification-tray.tsx` |
| Recents | None | Hidden | See the Shell rows above |
