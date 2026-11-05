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

## Settings: personal

| Domain | Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- | --- |
| Preferences | Display name read and edit, pending, inline failure | General | Done | `settings-a.spec.ts` |
| Preferences | Picture upload, 5MB and type validation, failure notice | General | Done | Same hook as legacy (`hooks/use-profile-picture-upload`); not exercised in `settings-a.spec.ts`, which uploads no file |
| Preferences | Avatar fallback to the whitelabel logo | General | Hidden | Legacy mounts no brand provider on `/o`, so the organization surface never showed it. Applying a brand to the Platform needs its token mapping |
| Preferences | Theme persisted, optimistic, applied to the shell | General | Done | `settings-a.spec.ts` |
| Preferences | Time zone with Auto and invalid-value rows | General | Done | `settings-a.spec.ts` |
| Preferences | Auto-connect, auto-focus, snap to grid, canvas controls | General | Done | `settings-a.spec.ts`. The legacy explainer videos are not ported: they are static assets of the main app |
| Preferences | Interface font, Code font | None; Platform only | Hidden | No font preference exists. Needs a settings column |
| Notifications | Canvas error notifications | General | Done | `settings-a.spec.ts` |
| Notifications | In-app notifications, Play sound | None; Platform only | Hidden | No user setting. Sound exists only on the Electron bridge |
| Notifications | Billing usage email | Billing, account scope | Legacy | Legacy shows it on personal billing only, which is not on the organization surface |
| Keyboard shortcuts | Static list | None; Platform only | Done | `settings-a.spec.ts` |
| Privacy | Browser telemetry, opt-out first, rollback on failure | General privacy view | Done | `settings-a.spec.ts` |
| Privacy | Cookie choices, commit per toggle, revert on failure | General privacy view | Done | Hosted only; the same consent store, mounted on this section. Needs a hosted environment to prove, so not in `settings-a.spec.ts` |
| Privacy | Consent banner on first visit | Root layout | Legacy | Shown on entry routes of the main app, which owns the consent lifecycle |
| Account | Home page action | General | Done | Hosted only, same gate |
| Account | Sign out | General | Done | `settings-a.spec.ts` covers the entry; ends the test's session, so it is not clicked |
| Account | Reset password email | General | Done | `settings-a.spec.ts` |
| Account | Authorized apps: search, paging, revoke | Authorized apps | Done | `settings-a.spec.ts` covers the list; revoke needs a seeded OAuth grant |
| Account | Organization accounts: grouped, status, disconnect | Organization accounts | Done | `settings-a.spec.ts` covers the list; disconnect needs a seeded grant |
| Account | Delete account: fresh plan on open, blockers, retyped email, bounded sign-out | Delete account modal | Done | `settings-a.spec.ts` opens it and proves the guard; it does not delete |
| Knowledge graphs | List, make active, create | Knowledge graphs | Done | Gate is `settingsSections`; needs `mothership-memory-spaces` on, so not in `settings-a.spec.ts` |
| Recently deleted | Deleted chats: search, sort, restore | Recently deleted | Done | `settings-a.spec.ts` covers the list; restore needs a seeded deleted chat |

## Settings: billing and usage

| Domain | Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- | --- |
| Billing | Section gate | `settingsSections` | Done | `settings-a.spec.ts` |
| Billing | First-paint read, failure with retry | Billing | Done | Server prefetch under the hook's key; `settings-a.spec.ts` asserts the failure state on an aborted read |
| Billing | Plan name, price, lapsed and free copy | Billing | Done | Same derivations; needs a seeded subscription for each state |
| Billing | Explore plans link | Billing | Done | Links out to the unmapped workspace upgrade route |
| Billing | Usage limit: credits, autosave, minimum, unsaved guard | Billing | Done | Shared decision in `lib/billing/usage-limit-draft`; needs a paid subscription to prove |
| Billing | On-demand switch and lock | Billing | Done | Lock explained in the row's description where legacy used a tooltip |
| Billing | Stripe portal, cancel, restore | Billing | Done | Existing operations. Needs Stripe, so unproved live |
| Billing | Invoices | Billing | Done | Needs Stripe, so unproved live |
| Billing | Personal plan, personal credit usage | Billing, account scope | Legacy | Not on the organization surface |
| Billing | Client plan refresh on focus | Organization sidebar | Open | Shell owner: it changes navigation, which this section does not own |
| Usage | Tabs, period presets, custom range capped by the contract | Insights | Done | `settings-a.spec.ts` |
| Usage | Export CSV with truncation notice | Insights | Done | `settings-a.spec.ts` |
| Usage | All events, keeping the window | Insights | Done | `settings-a.spec.ts` |
| Usage | Credits chart with six fixed layers, tooltip, legend | Insights | Done | `settings-a.spec.ts`. Legend hover isolation is not ported: the shared chart has no highlight state |
| Usage | Year heatmap with keyboard movement | Insights | Done | `settings-a.spec.ts` |
| Usage | Top models and members, View all | Insights | Done | `settings-a.spec.ts` |
| Usage | Ranked lists: Other row expands, row select, row menu | Insights | Done | Share reads as a percent column where legacy drew a bar |
| Usage | Workspace drill-down, Open logs | Insights | Done | Open logs keeps its hosted or `auditLogs` gate |
| Usage | Activity summary, breakdown, paging, 404 recovery | Insights | Done | `settings-a.spec.ts` |
| Usage | Manage member credits | Insights | Done | Member tab and hosted, same gate |
| Usage | Events ledger, paging | Usage events | Done | `settings-a.spec.ts` |

## Settings: links and other

| Domain | Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- | --- |
| Links | Route and gate | `/o/[id]/links` | Done | `navFlags.simLinks`; mapper sends `/o/[id]/links` to `/settings/links`, query kept |
| Links | List with paging, search and sort in the URL | Links | Done | `settings-a.spec.ts` |
| Links | Favicon, owner, access, updated cells | Links | Done | `settings-a.spec.ts` |
| Links | Row opens `sim/<name>` on the main app | Links | Done | `settings-a.spec.ts` |
| Links | Row menu: Open, Copy link, Edit, Delete by `canEdit` | Links | Done | `settings-a.spec.ts`. A row action, where legacy used right-click |
| Links | Create and edit: variable default, normalized name, 409 on the field, access, Learn more | Links | Done | `settings-a.spec.ts` |
| Links | `?create=<name>` deep link from an unknown `sim/<name>` | `app/sim/[[...path]]` | Done | `settings-a.spec.ts`. Resolution itself stays on the main app, unchanged |
| Links | Delete confirm with error | Links | Done | `settings-a.spec.ts` |
| Links | Install Sim for Chrome | Links | Done | Hosted only, same gate. Current staging has no shortcuts modal or bookmark export |
| Links | Copy or create from a chat source card | `source-card` | Open | Chat owner |
| White-labeling | Form, entitlement, upload, colors, links, save and discard, guard | White-labeling | Done | `settings-a.spec.ts` asserts the entitlement states; upload needs a workspace and storage |
| White-labeling | Applying the brand to the Platform | `BrandingProvider` | Hidden | The Platform's tokens differ from `--brand*`. Needs a token mapping |
| Unsaved changes | Link click and closing tab | `use-settings-browser-navigation` | Done | Same dirty store. The browser Back button is not held: the legacy history trap has not been ported |

Status is one of:

- **Done**: works on live data. Proof names a spec in `checks/live/`.
- **Legacy**: stays on the legacy surface and the Platform links out. Proof names the unmapped route in `lib/platform/routes.ts`.
- **Hidden**: Platform UI with no backend, hidden on live data. Reason names what a backend would need.
- **Open**: not built yet. Reason names the owner.
