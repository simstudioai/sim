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
