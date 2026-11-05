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

## Settings: governance

Proof `settings-b` is `checks/live/settings-b.spec.ts`. Every API behind these sections keeps its own server gate; the navigation entry comes from `organization.settingsSections`.

| Domain | Capability | Legacy source | Status | Proof or reason |
| --- | --- | --- | --- | --- |
| Permission groups | List, search, count, Default tag, member and workspace summary, Review requests link | `ee/access-control/components/access-control.tsx` | Done | `settings-b` |
| Permission groups | Create: name, description, default, workspaces, inline error; non-default needs a workspace | `access-control.tsx` | Done | `settings-b` |
| Permission groups | Deep-linked detail, tab, search and status on the legacy URL keys, reset together | `group-detail.tsx`, `ee/access-control/search-params.ts` | Done | `settings-b` |
| Permission groups | Name, description (100/500, required), save, discard, set-based dirty check, delete | `group-detail.tsx`, `ee/access-control/lib/editor.ts` | Done | `settings-b` |
| Permission groups | Default switch and workspace scope, optimistic with sequence guard and revert | `group-detail.tsx` | Done | `settings-b` |
| Permission groups | Members: list, remove, add modal with search and select all, external excluded | `group-detail.tsx` | Done | `settings-b` |
| Permission groups | Allowlist universe: includes viewer-gated blocks, excludes superseded blocks | `ee/access-control/lib/editor-registry.ts`, `lib/permission-groups/block-access.ts` | Done | `settings-b` reads the unfiltered catalog route; `group-detail.test.tsx` for the shared module |
| Permission groups | Providers tab, Agent default with validity, static and dynamic models, three-state editor, inheritance, bulk | `permission-rows.tsx`, `agent-default.tsx`, `ee/access-control/lib/editor.ts` | Done | `settings-b` |
| Permission groups | Blocks tab: core and integrations, per-tool expand; rendered list hides viewer-gated rows | `permission-rows.tsx`, `GET /api/organizations/[id]/permission-groups/editor-catalog` | Done | `settings-b`. A custom block appears on Platform in the org surface, where the legacy `/o` surface never hydrated them |
| Permission groups | Block colour tile | `permission-rows.tsx` | Hidden | Rows use the shared provider mark; a per-block colour would be a per-screen override |
| Permission groups | Platform tab: categories, inert rows, nested grids, project issue restrictions | `group-detail.tsx`, `project-issue-restrictions.tsx`, `hooks/queries/project-list.ts` | Done | `settings-b` |
| Audit logs | Feed, paging, search in URL, type multi-select, time range with custom calendar | `ee/audit-logs/components/audit-logs.tsx` | Done | `settings-b` |
| Audit logs | Fail-closed workspace scope, chip clears it, refresh repeats the gate | `ee/audit-logs/lib/scope.ts` | Done | `settings-b` opens a stale scoped link and sees no rows and no export |
| Audit logs | Export CSV, truncation notice, disabled unless the scope is answerable | `ee/audit-logs/lib/scope.ts`, `lib/core/utils/csv-download.ts` | Done | `settings-b` |
| Audit logs | Entry detail and metadata rendering, all empty states | `ee/audit-logs/lib/format.ts` | Done | `settings-b` |
| Sign-in | Plan gates, tabs with docs link, hidden tabs stay mounted | `ee/sso/components/sso-settings.tsx` | Done | `settings-b` |
| Sign-in | Provider list as routing table, Primary tag, make primary, delete naming who signs in next | `ee/sso/lib/provider-form.ts` | Done | `settings-b` |
| Sign-in | Add and edit form, OIDC and SAML, all fields and validation, attribute mapping, callback and entity values | `ee/sso/lib/provider-form.ts` | Done | `settings-b`; `sso-settings.test.tsx` for the shared module |
| Sign-in | Client secret write-only: masked fact, Replace, Keep saved, blank keeps the stored secret, no copy | `ee/sso/lib/provider-form.ts` | Done | `settings-b` asserts the stored secret never reaches the page |
| Sign-in | Password-manager decoy inputs and read-only-until-focus | `sso-provider-settings.tsx` | Hidden | Uses `autoComplete` off or `new-password` on the shared fields, which take no focus hooks or decoys |
| Sign-in | Require SSO: confirm on enable, explanation, off always available | `require-sso-section.tsx`, `ee/sso/lib/provider-form.ts` | Done | `settings-b` |
| Domains | Add with Enter, status, host and TXT copy, verify, remove with SSO warning, all states | `verified-domains-section.tsx` | Done | `settings-b` |
| Provisioning | Enable, base URL, status, provisioning rules, activity, reconcile | `ee/scim/components/scim-section.tsx` | Done | `settings-b` |
| Provisioning | Tokens: issue with expiry, one-time secret through `CopyField`, revoke, two-token cap | `scim-section.tsx` | Done | `settings-b` |
| Provisioning | Group mappings: add, remove, attention notices, name-match warning | `ee/scim/lib/group-mapping-view.ts` | Done | `settings-b` |
| Security | Session policy: lifetime and idle bounds, save, discard, enterprise gate | `ee/session-policy/lib/policy-form.ts` | Done | `settings-b` |
| Security | Sign out all members, current session excepted by the server | `session-policy-settings.tsx` | Done | `settings-b` opens the confirmation only; it does not revoke |
| Security | Outbound IPs with copy, blocked, pending and unconfigured copy, retry | `components/settings/organization-security.tsx` | Done | `settings-b` |
| Data retention | Policy list, summaries, add override, remove with confirm, whole-document save | `ee/data-retention/lib/policy-draft.ts` | Done | `settings-b` |
| Data retention | Log, soft delete and task periods, Inherit on overrides, clamped to the contract | `ee/data-retention/lib/policy-draft.ts` | Done | `settings-b` |
| Data retention | PII stages, entity grid with search and language prune, custom patterns | `policy-draft.ts`, `lib/guardrails/custom-patterns.ts` | Done | `settings-b` |
| Data drains | List, search, deep link holds first paint, states | `ee/data-drains/components/data-drains-settings.tsx` | Done | `settings-b` |
| Data drains | Create with all eight destinations; credentials write-only | `ee/data-drains/destinations/specs.ts` | Done | `settings-b` |
| Data drains | Detail: enabled, Run now, Test connection, schedule, destination, runs, delete | `data-drain-detail.tsx` | Done | `settings-b` |
| Settings | Unsaved-changes guard | `components/settings/use-settings-unsaved-guard.ts` | Open | Back, shell links and tab close are guarded by `section-parts/use-unsaved-guard`. Browser back is not, the SCIM enable switch does not read a shared navigation block, and each editor guards alone, so a discard covers one dirty editor rather than all of them. Owner: settings shell, with one guard provider |

Status is one of:

- **Done**: works on live data. Proof names a spec in `checks/live/`.
- **Legacy**: stays on the legacy surface and the Platform links out. Proof names the unmapped route in `lib/platform/routes.ts`.
- **Hidden**: Platform UI with no backend, hidden on live data. Reason names what a backend would need.
- **Open**: not built yet. Reason names the owner.
