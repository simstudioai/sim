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

## Members

Every row runs on live data through `lib/data/members.ts`. Proof names a spec in `checks/live/members.spec.ts`; a row proved only by the design and type gates says so.

| Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- |
| Section access, aliases `organization` and `team` | `O/settings/[section]`, `O/settings/navigation.ts` | Done | Section gate from `settingsSections`; aliases resolved by `lib/platform/routes.ts` before arrival |
| Viewer role from the viewer's roster row, falling back to the server-read surface, never Better Auth's capped list | `TM/team-management.tsx` | Done | "plain member sees no controls" |
| Roster, name and email, avatar, joined date, directory deactivation, empty, loading and error with retry, prefetch for first paint | `organization-member-lists.tsx`, `settings-query-warmers.ts` | Done | Spec setup; `prefetchRoster` under the hook's key |
| Search across every section in `?search=`, sections collapse, no-match copy | `organization-member-lists.tsx` | Done | Static reading; needs a spec |
| Change role, with row controls matching the server's guards | `organization-member-lists.tsx` | Done | "a role change persists" |
| Role, resend, revoke and workspace mutation failures reach the viewer. Legacy only logged them | `organization-member-lists.tsx` | Done, not copied | "a failed one is reported", `reportFailure` for the rest |
| Remove member. Path parameter is the user id | `TM/team-management.tsx`, `remove-member-dialog.tsx` | Done | "removal holds on its disclosure" |
| Removal impact disclosure holds confirm on any refetch, cautions on a failed check | `TM/team-management.tsx`, `remove-member-dialog.tsx` | Done | "removal holds on its disclosure" |
| Leave organization, full navigation after | `TM/team-management.tsx` | Done | Static reading; destructive for the seeded admin, needs its own seed |
| Transfer ownership and leave, candidates admin first, only-member state, Stripe portal notice. Legacy labelled it "Transfer ownership" though it always leaves; the Platform label says so | `transfer-ownership-dialog.tsx` | Done, not copied | Static reading; needs its own seed |
| Manage credits, gated on hosted. Legacy offered it self-hosted, where the API answers 404, and showed no error | `manage-credits-modal.tsx` | Done, not copied | Static reading; load failure shows a retry |
| Seats: none with View plans, Team count with pending, Enterprise meter and over limit, error with retry | `team-seats-overview.tsx` | Done | Static reading; needs billing seed |
| Per-workspace sections, permission select, lock reason, remove from workspace. Legacy offered removal of the billed account, which the server refuses | `organization-member-lists.tsx`, `components/permissions/role-lock.tsx` | Done, not copied | Static reading; needs workspace seed |
| Pending invites: role, grant, resend, revoke | `organization-member-lists.tsx` | Done | Static reading; invite created by "partial invite failure" |
| Invite from Members and the org menu, role choice, format and self rejection, advisory seat check, success summary | `invite-modal.tsx` | Done | "a partial invite failure" |
| Partial invite failure retains only the failed addresses, with reasons | `invite-modal.tsx` | Done | "a partial invite failure" |
| Invite's workspace picker and External membership | `invite-modal.tsx` | Legacy | Only offered from a workspace entry, and none exists on this surface |
| Invite acceptance | `app/invite/[id]` | Legacy | Stays at `/invite` by decision |
| My pending invitations | `pending-invitations/` | Legacy | Workspace header only; not on the organization surface today |
| No-organization recovery and create organization | `no-organization-view.tsx` | Legacy | Unreachable here: the surface requires membership |

## Requests

Every row runs on live data through `lib/data/requests.ts`, with the legacy query parsers, so email links keep working.

| Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- |
| View switch, default review for administrators | `AR/access-requests-settings.tsx` | Done | Static reading |
| Legacy query parameters, including `view=admin` and `request-id` | `AR/search-params.ts`, `ee/access-requests/lib/navigation.ts` | Done | Static reading; `requests-section.tsx` normalizes through the legacy function |
| My requests, paging, status, empty and error states | `AR/access-requests-settings.tsx` | Done | Static reading |
| Browse access, search, available and pending states, paused notice | `AR/access-requests-settings.tsx` | Done | Static reading |
| Request access dialog: reason, already allowed, paused, retry, view pending | `AR/request-access-action.tsx` | Done | Static reading |
| Request details, withdraw | `AR/my-access-request-details.tsx` | Done | Static reading |
| Allow requests toggle, failure reported | `AR/organization-access-requests.tsx` | Done | Static reading |
| Review list: status filter, search, paging, count, empty copy | `AR/organization-access-requests.tsx` | Done | Static reading |
| Review: preview, policy changes and details, credit limit, decline reason, `expectedFingerprint` on apply | `AR/access-request-review.tsx`, `AR/policy-changes.tsx` | Done | Static reading; description helpers shared through `ee/access-requests/lib/policy-description.ts` |
| Cross-surface prompts: `PermissionAccessBoundary`, `MemberLimitRequestAction` | `AR/permission-access-boundary.tsx` | Legacy | Read `workspaceId` from a workspace route; no such surface here |

No Requests spec exists yet: it needs a seeded requester, a governing permission group and a reviewer. Rows proved by static reading are not yet proved on live data.

## People

Every row runs on live data through `lib/data/people.ts`. `/people` answers 404 in fixture and fixture-off modes.

| Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- |
| Page gate on `canBrowsePeople`, from `navFlags.people`. Legacy's page used the weaker flag check and rendered a refusal as a load error | `O/people/page.tsx`, `lib/people/feature-flag.ts` | Done, not copied | "a member withheld the directory" in `people.spec.ts` |
| Directory: windowed table, paging, profile links with the origin in the query, search in the URL, department filter with counts and server search, filter tag, loading, empty, no results, error and load-more failure | `O/people/people-directory.tsx` | Done | "the directory filters" in `people.spec.ts` |
| Identifiers: `memberId` is a directory id here, and `userId` can be null | `lib/api/contracts/people.ts` | Done | No People path uses `userId` |
| Org chart in a fixed CSS layout: manager, focus, up to four reports. Replaces the canvas, so zoom, pan and fit are gone by decision | `O/people/chart-canvas.tsx` | Done | "the chart reads without a canvas" in `people.spec.ts` |
| Chart: reporting path, top-level teams, find a person, My position, report paging by viewport, keyboard focus restoration, empty state with CTAs, 404, refusal against transient, loading, five-minute refresh | `O/people/people-chart.tsx`, `chart-empty-state.tsx` | Done | "the chart reads without a canvas" covers 404; the rest by static reading |
| Profile: details, department link, Managed by, tenure, reports, View in org chart, Back preserving origin, 404, refusal against transient | `O/people/[memberId]/person.tsx` | Done | "the directory filters" covers Back; the rest by static reading |
| Edit profile, gated on admin and no directory source, manager search, suspended manager label, field errors | `O/people/[memberId]/person-modal.tsx` | Done | Static reading |
| Import: sources, SCIM gate and readiness, token-safe mutation, file parse with its memory guard, template, preview, `previewDigest` apply, 409 returns to preview, dismiss locked in flight | `people-import-modal.tsx`, `import-source.tsx`, `read-sheet.ts` | Done | Static reading; needs provider or file seed |
| Directory sync: status with polling, state tag, progress, activity, connect, update, disconnect, run footer states, `?panel=sync`, load error, stays dismissable while a sync runs | `directory-sync-modal.tsx`, `directory-sync-form.tsx` | Done | Static reading; needs provider seed |
| Benchmark | `O/benchmark` | Legacy | Stays legacy by decision |
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
| Analytics and telemetry, including `docs_opened` and `slack_community_opened` | `app/layout.tsx`, `organization-sidebar.tsx` | Open | No PostHog provider is mounted here, so the help menu sends no events |
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
| Global command registry semantics | `global-commands-provider.tsx` | Done | Editable guard ported for `Mod+B`. The Platform has two commands and nothing claims `Mod+B` through `data-owned-shortcuts`, so no registry |
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
| Status dot and pin glyph | `chats-section.tsx` | Done | `ChatIndicator` in `chats-section.tsx`. On touch, where the row action is always shown, the indicator gives way to it. Unproved |
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
