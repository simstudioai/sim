# Project entity foundation: implementation and rollout proposal

Backend foundation implemented locally, with backfill hardening validated on 2026-10-01, following the approved planning review. Final feature review and hosted rollout remain separate. Database validation uses disposable test containers only. See the implementation and rollout notes below for the concrete scope.

Migration `0393_project_foundation` follows `0392_dashboard`. The schema expansion and application writers belong in the foundation release; backfill and contract enforcement follow separately.


## Decisions and blockers

Settled: Project and environment are separate identities; existing workspace IDs remain environment IDs. Issues belong to Project across environments. Project and environment names are independent. Workflow, table, file, knowledge and dashboard data remain environment scoped. Chat has no Project ownership or membership relation. Selecting a Project is navigation state, not execution authority. Ship backend/feature PRs before new UI.

The user settled Project visibility and Issue access: any environment access makes the Project visible; the toggle lists only accessible environments. Issues are project-wide and all-or-nothing, available by default to anyone with access to any environment. Through permission groups, an org admin can disable all Issues for a Project for partial-access teammates (those lacking access to every environment in that Project). This replaces the earlier explicit Project-membership proposal for Issue access.

1. **Access — settled:** derive navigation and default Issue access from current environment access. Apply the permission-group restriction only to partial-access teammates, for the target Project; no per-Issue or per-environment filtering of the Issue collection. Restricting Issues does not hide the Project or its accessible environments. Project rename/archive is allowed for org admins and workspace admins who administer every environment; Issue visibility alone does not grant administration. The partial-access Issue check excludes archived environments.
2. **Disconnect — settled:** disconnecting a fork moves it and all descendants into a newly created Project, atomically with unlinking the fork edge. The original Project retains its ID. Existing Issues stay in the original Project; the new Project starts empty. A user may explicitly ask Sim Chat/Mothership to migrate Issues later through an authorized operation, rather than coupling Issue migration to disconnect.
3. **Personal scope — settled:** Projects can exist without an organization. Organization deletion preserves each Project and all of its Issues together, retaining the Project ID and assigning an explicit personal owner; no Project/Issue cascade or replacement Project creation.

Settled organization-deletion behavior: transfer each Project to an explicitly selected personal owner while retaining its ID and Issues, rather than splitting its Issues between former environment owners. Project archive cascades to every environment and workflow. An active Project must retain at least one active environment; users cannot individually delete/archive the last one. Whole-Project archive is the explicit exception, leaving an archived Project with archived environments, not an empty active Project. Cross-organization environment moves must explicitly separate the moved environment from the old Project or move the entire Project. Existing Issues stay with their original Project on fork disconnect; a later user-requested migration is a separate operation. These policies are particularly important for subscription cancellation and administrative organization deletion.

No Project member table or grant backfill is required for the settled Issue-access model. Evaluate existing effective environment access and applicable permission-group policy at authorization time. Permission changes immediately affect access; do not materialize permanent Project grants. The Issue partial-access comparison uses non-archived environments, as confirmed by the user. Zero-active-environment Projects are permitted only in archived state, with their environment rows retained. Require at least one accessible active environment for ordinary active-Project access; use explicit archived-resource authorization for archive inspection/restore, never the empty all-environments predicate; do not treat an empty set as full access. External collaborators use their existing effective access, without introducing a new org-membership requirement solely for Issues.


Lifecycle behavior: existing Issues remain with the original Project after disconnect; explicit migration can be requested through Sim Chat/Mothership. Org admins or callers with admin on every environment may rename/archive. Archived environments are excluded from the Issue partial-access comparison. The separate all-environment administrative rule includes archived environments; the exclusion applies specifically to Issue access.

Organization deletion — settled: preserve each Project and its Issues together and assign an explicit personal owner, matching the existing workspace-preservation pattern. Do this atomically with workspace detachment and organization deletion; do not rely on a bare SET NULL FK or infer authority from the billing payer. Detachment assigns the current organization owner as the Project lifecycle owner, matching workspace detachment. If the organization has no owner, the Project retains its required existing lifecycle owner. The FK prevents unresolved user ownership. Subscription lapse is non-destructive as well; it must never reuse a Project/Issue purge path.

## Organization-deletion preservation contract

Verified at this planning baseline:

- `apps/sim/app/api/v1/admin/organizations/[id]/route.ts:302`: transaction calls detach, organization-resource cleanup enqueue, then org delete. Its deletion contract explicitly says workspaces survive; subscriptions referencing the org block deletion.
- `apps/sim/lib/workspaces/organization-workspaces.ts:426`: detach selects organization-mode workspaces without excluding archived rows, clears organization via payer transfer, sets mode to `grandfathered_shared`, and grants admin to the new billing account (org owner if present, otherwise workspace owner). This is not a workspace purge.
- `apps/sim/lib/organizations/resource-cleanup.ts`: captures directly organization-owned files/chats before FK cascade in a transactional outbox. It is not a blanket workspace-resource cascade.
- `apps/sim/lib/auth/auth.ts:1773`: Better Auth organization deletion is disabled.
- `apps/sim/lib/billing/webhooks/subscription.ts:140`: subscription dormancy calls workspace detach, retaining the org. Reusing this helper must not accidentally delete Projects/Issues when a subscription lapses.

Enumerate affected Projects under the organization lifecycle lock before changing workspace organization/membership. Compare `project.organizationId` with canonical membership/workspace ownership, report inconsistent or mixed-tenant Projects, and include archived org Projects and report legacy empty-Project anomalies that a workspace-only join would miss. Resolve and validate an explicit personal owner for each Project, update ownership to personal, and detach its environments in the same transaction before the organization is deleted. Preserve Project IDs, membership rows, Issues and Issue attachments; do not enqueue them for org-resource cleanup. Existing direct org chat/file cleanup remains separate. Retire organization-specific permission-group bindings explicitly after scope transfer; personal access then uses current effective environment access under the agreed policy. Do not copy grants or restrictions from unrelated orgs. A transfer must not leave a surviving Project referencing a deleted group or organization. Record old/new ownership and audit the actual operator, not the new owner or payer. Restrictive ownership FKs force the lifecycle operation to complete explicitly; they are not a reason to purge data.

## Column-by-column schema proposal

The preferred schema below uses environment-derived access and supports the accepted personal Project model. All new identifiers use `generateId()` and text columns, matching workspace and organization IDs. IDs are immutable and independent of names, lineage roots and deployment environment.

| Column | Proposal and reason |
| --- | --- |
| `project.id` | Text PK, application-generated UUID v4. Never reuse a workspace ID; never recompute after backfill. |
| `project.name` | Non-null text; trim, require 1–100 characters in domain validation and enforce compatible DB bounds/nonblank check. Allow duplicate names; IDs disambiguate. No slug or case-insensitive unique-name constraint without a product requirement. |
| `project.organizationId` | Nullable FK to organization, `ON DELETE RESTRICT`. Null only for explicitly personally owned Projects. An explicit lifecycle transaction transfers Projects before organization deletion. Organization transfer must include archived Projects and surface legacy empty-Project anomalies too. |
| `project.ownerId` (new) | Required user FK, `ON DELETE RESTRICT`, retained on both personal and organization Projects, matching the workspace lifecycle-owner model. Lifecycle ownership, not implicit access. Anchors lifecycle ownership independently of environment owners; individual removal of the last environment is prohibited. Personal-owner deletion transfers or explicitly deletes the Project before user deletion. |
| `project.archivedAt` | Nullable timestamp; setting it archives the Project and all member environments/workflows through one compound operation. Preserve archived environment rows and Issues. Archived detail remains readable to authorized members; normal lists omit it unless requested; Project/Issue mutations reject except restore or approved cleanup. |
| `project.createdAt` | Non-null timestamp default now, immutable. Backfill records actual creation time; retain existing environment history rather than pretending the Project existed earlier. |
| `project.updatedAt` | Non-null timestamp default now; explicitly set by Project metadata/ownership/archive writes. `defaultNow` alone is not an update trigger. Environment membership changes are audited and update the affected environment timestamp; policy changes update their policy records. |
| root/default environment, icon/color, pipeline position, billing fields | Omit from foundation. None is needed for Issue identity or authority. A default execution environment, if added, must still be independently authorized. |

Indexes: organization list index on `(organization_id, archived_at, id)`; personal-owner list index on `(owner_id, archived_at, id)`; sort by stable ID cursor initially, avoiding a name-based cursor that changes on rename. Add a name-sort index only if the selected list contract requires it. Foreign-key referencing columns need indexes for ownership/deletion lookup. Do not duplicate a simple organization index without demonstrated need.

| Environment membership field | Proposal |
| --- | --- |
| `project_workspace.projectId` | Non-null text FK to Project. Prefer `ON DELETE RESTRICT` while environments remain, so deleting a Project cannot silently orphan environments. Changing membership on disconnect is an explicit transaction. |
| `project_workspace.workspaceId` | Non-null workspace FK with cascade on workspace deletion; unique index enforces at most one Project per environment. Use a composite PK `(projectId, workspaceId)` plus unique workspace index; Project-leading PK supports member lookup. |
| `project_workspace.createdAt` | Non-null timestamp default now, recording membership-row creation. On reassignment retain creation time and audit the move; introduce assignment timestamp only if required by an actual consumer. |
| `workspace.forkedFromWorkspaceId` | Keep existing lineage edge and `ON DELETE SET NULL`. Explicit disconnect creates a new Project; implicit edge removal on hard parent deletion does not silently move Issue ownership. |
| `workspace.organizationId` | Retain for compatibility/resource authorization. Proposed same-organization invariant with Project uses null-safe comparison and shared transactional scope changes; deferred constraint triggers validate final state across Project, membership and workspace writes. |

**Membership storage:** a direct non-null `workspace.projectId` would enforce exactly-one membership more simply, but the accepted design uses `project_workspace`; do not implement both. The unique workspace index only enforces at most one. Add deferred constraint triggers on workspace insert and membership deletion/update to require one membership for every surviving workspace at commit after rollout. Lock/recheck the workspace when reassignment can race; deletion must allow cascaded removal for a workspace that no longer exists. Ship this enforcement only after compatible writers and backfill are complete. Require at least one environment membership for each Project and at least one active environment for each active Project. Archived Projects retain member rows but may have no active environments. Complement application checks with deferred final-state constraints after rollout; source and destination Projects must be checked on membership moves.

Do not add `project_member` for navigation or Issues. Extend the existing permission-group model with a Project-targeted restriction on Issue access for partial-access teammates. Its absence means no extra restriction. Resolve the Project organization canonically; only its org administrators may configure it. Reuse existing group assignment and policy-composition rules instead of inventing a per-user grant table. The current resolver in `lib/permission-groups/config-scope.server.ts` is workspace-keyed; add intentional Project scope rather than passing a selected/root environment. Exact storage follows the permission-group skill during implementation. Project rename/archive authority is org admin OR admin on every environment; do not infer admin from an arbitrary environment. Never grant administration through an empty all-environments check. Active empty Projects are invalid; archived-resource operations authorize explicitly against retained environment grants and org administration.

## Membership and lifecycle invariants

1. Every environment, including archived ones, belongs to exactly one Project after enforcement. Each Project contains at least one environment; active Projects have at least one active environment. Whole-Project archive permits zero active environments while retaining archived member rows.
2. Environment and Project organization scopes agree. Personal environments within a Project may have different lifecycle owners only if one explicitly selected Project owner governs Project lifecycle; that must not transfer environment ownership or grant access.
3. Fork creation inherits its parent's Project in the same transaction after rechecking current source scope under lock. Existing fork families seed Projects initially. Explicit disconnection splits the subtree into a new Project. Multiple roots can still arise through parent deletion; do not infer Issue movement from root counts alone.
4. Nested forks inherit the same Project; siblings need not have a unique depth. A disconnected fork and every descendant move together to a fresh Project. Never manufacture a new Project from a missing-parent/backfill race. Reevaluate Issue eligibility on both Projects after the split: a previously partial-access user may become full-access. Project-targeted permission-group restrictions also need explicit migration semantics; proposed preserve applicable restrictions on the new Project rather than accidentally resetting configured policy, while acknowledging the all-or-nothing rule now applies to each new environment set. Record policy handling and both Project IDs in the operation audit. Existing Issues stay with the original Project. Explicit user-requested migration through Sim Chat/Mothership must authorize source and destination Projects under one semantic application operation, with atomic/retry-safe movement and audit; it is an Issues feature, not a Project-foundation dependency.
5. Renaming an environment does not rename the Project; rename the Project through its own operation. Backfill and implicit Project creation through legacy workspace creation use `<first/root workspace name> - Project`; explicit Project creation accepts independent Project and initial environment names. Workspace names remain untouched. Bound the generated Project name without losing its suffix, with `Untitled` for an empty source; surface any length normalization in the report. Duplicates are allowed and recorded, not merged.
6. Individual environment delete/archive must leave at least one active environment in an active Project and at least one member environment overall. Block removal of the last environment; direct hard-delete, account deletion, moves and fork disconnect cannot bypass the invariant. Serialize on the Project so two concurrent removals cannot each see the other as the remaining environment. For disconnect/move, validate both resulting Projects; refuse a split that strands the original as active with no active environment. Coordinated whole-Project lifecycle operations are the explicit exception for active-count checks, not an adapter flag that callers can freely set.
7. Project archive is one authorized compound operation that archives every environment and workflow, including operational deactivation already owned by existing archive paths. Retain membership rows and Issues. Reject new environment/fork/workflow admission into an archived Project. Preserve pre-existing archived states. Current `lib/workspaces/lifecycle.ts` commits workspace/resource archival before calling `archiveWorkflowsForWorkspace`; looping this helper across environments would permit a partially archived Project. Refactor transaction-owning primitives so durable Project/environment/workflow state changes commit atomically, with existing required external effects queued/retried after commit. Failure must not be reported as complete while workflows remain active. Project restore is deferred until a complete inverse exists; do not ship a metadata-only unarchive that leaves no active environments or silently revives resources archived before the Project. Archival does not imply cancellation of already-running executions beyond existing archive semantics unless separately specified.
8. Moving one environment between organizations cannot retain its old Project membership. For initial shipment, refuse a partial Project transfer unless the operation explicitly names a destination/new Project and defines the Issue outcome; preserve original Project Issues. A whole-Project transfer requires authorization and disclosure for all environments, retained Project data, collaborators and Issues.
9. Organization cancellation/detach/deletion must process Projects and all member environments atomically with existing payer transfers. The legacy per-owner workspace detach cannot silently determine how to split Project-wide data. If a complete, authorized transfer cannot be determined, stop before committing rather than silently orphaning or broadening access.
10. Project hard delete is not required to unblock Issues. Restrict it while environments or Issues exist. `issue.projectId` should be NOT NULL with restrictive deletion until an explicit purge policy is implemented. Deleting an account must account for personally owned Projects and retained Issues, not merely surviving workspace grants.

## Authorization and application surface

Provide a shared canonical Project application context: `{ projectId, organizationId, ownerId, archivedAt }`, loaded by ID, with optional asserted organization/workspace scope compared to canonical data. Return not-found for hidden/mismatched scope, consistent with shared concealment policy. Loading must be inside the authorized application-use-case lifecycle; an HTTP/tool adapter may not query protected membership itself.

Create a small shared Project authorization wrapper alongside the existing workspace/organization wrappers. It must reject unsupported Principal kinds before loading protected data; authorize current effective environment access and applicable Project-scoped permission-group policy; distinguish Issue use from Project administration; respect archive state and typed errors; project semantic audit from authoritative results; and keep external side effects after success. Mutations lock and recheck Project state/authority sufficiently to serialize with environment access revocation, environment-set changes, policy changes, organization transfer and archive. Persist a durable audit/outbox record inside the transaction where existing shared infrastructure supports it; do not report a committed mutation as absent because a later notification fails.

Do not use `defineAuthorizedWorkspaceUseCase` with an arbitrary root environment. Staging has both `defineWorkspaceOperation` and `defineOrganizationOperation`; the latter currently accepts session/organization-delegated principals and cannot model personal Project scope alone. Extend the shared foundation intentionally, rather than hiding authorization in `projects.ts` or borrowing a payer identity.

Proposed first contract (session surface; supported principal expansion is explicit):

| Operation | Authority and behavior |
| --- | --- |
| `projects.list` | Paginated Projects containing an accessible environment, in requested owner scope; archived Projects require a separate explicitly authorized archive listing, never vacuous environment-access checks; archived filter. No inaccessible environment IDs, names, counts or fork parent references. |
| `projects.get` | Basic navigation metadata visible through an accessible environment (archived-resource access uses a separate explicit policy); Issue and administrative capabilities checked separately; stable `{ id, name, organizationId, archivedAt, createdAt, updatedAt }` plus caller capabilities. |
| `projects.resolveForWorkspace` | Authorize environment access; it permits resolving basic Project navigation metadata through the canonical `project_workspace` membership, without requiring a separate Project grant. Never accept a supplied Project ID as truth. |
| `projects.listEnvironments` | Project navigation visibility plus each environment's existing access policy; filter hidden parents in lineage output. Paginate rather than embedding all environments in every Project result. |
| `projects.create`, `rename`, `archive` | Creation atomically creates the first environment under existing creation/quota policy. Rename/archive require org admin or admin on every environment; archive cascades to all member environments/workflows. Do not automatically add member grants. No zero-environment creation endpoint. Restore is deferred until full environment/workflow lifecycle behavior is defined. |
| `projects.addEnvironment` | One compound use case authorizing Project administration and existing workspace-creation policy, then atomically creating environment with correct Project membership. Legacy workspace creation still creates its own Project. |
| Project Issue restriction configuration | Existing permission-group application operations extended with Project scope; org-admin authorization and canonical group/Project organization matching. No separate Project membership CRUD. |
| Issue operations | Use the all-or-nothing Issue gate below; action-specific mutation policy remains to be agreed without introducing partial Issue visibility; canonical Issue lookup verifies `issue.projectId`. No environment ID required for Issue CRUD. Links to environment resources are individually authorized on resolution. |

Issue authorization for a human caller uses the complete canonical environment set E and the subset A for which the caller currently has effective access. The server must compute E independently of the filtered environment-toggle response:

```text
canViewProject = |A| > 0
hasPartialEnvironmentAccess = |A| > 0 AND |A| < |E|
canUseProjectIssues = canViewProject
  AND NOT (hasPartialEnvironmentAccess AND effectiveGroupPolicyDisablesIssuesForThisProject)
```

The agreed truth table is: no accessible environment -> no default Issue access; some environments -> all Issues by default, none when the restriction applies; all environments -> the partial-access restriction does not deny Issues. Normal authentication, principal-kind and archive/action rules still apply. Return Issue capability separately from navigation capability. Never return hidden environment names/IDs/counts merely to explain a denial.

Enforce this once in the shared Project Issue authorization path used by list/detail/mutations, search, counts, notifications/subscriptions, exports and tools. A denied caller must not receive Issue titles or other Issue data through side channels. Existing environment resources linked from Issues still require their own environment checks; access to all Issues never grants production access. Ordinary Issue mutation roles belong to the Issues implementation, but may not create a per-environment Issue subset. Project rename/archive uses org-admin OR all-environment-admin authority; permission-group edits remain org-admin operations.

Creation/deletion/archive/restoration/move of environments and access grants/revocations can change partial/full status. Reevaluate on the server and invalidate relevant capability/policy caches and live subscriptions. Serialize mutating checks with changes that can alter the decision. Do not select the policy using whichever environment the user toggled to. Missing policy defaults to allow, but a policy lookup failure must propagate as an error, not be interpreted as an absent restriction. Archived environments are excluded from this Issue access comparison, as confirmed by the user.

Start Project HTTP routes at `/api/projects` and `/api/projects/[id]`, with named contracts under `lib/api/contracts/projects.ts` and shared builders. Add environment lookup and permission-group configuration routes as needed by the first consumer. Query hooks use `requestJson`, named contract types and React Query. Start with a session-only Project API; do not advertise unsupported key/delegation support.

Workspace API keys and workspace-scoped executor/system principals **must not** gain project-wide Issue access just because their environment points at the Project. Personal API keys/OAuth need an explicit Project credential policy (there is no unambiguous environment `allowPersonalApiKeys` switch at this scope), scope enforcement and permission-group checks before v2 Project routes ship. Organization delegation already exists, but is documented/search-scoped; extend trusted audience/operation policies and recheck current subject membership before admitting Project operations. Org chat Project selection is a requested target only. No chat-to-Project relation, implicit default environment, or copied grant.

The Issues implementation can build on the foundation contract. Existing environments become usable for Issues only after validated backfill/enforcement; new properly provisioned Projects can be exercised earlier behind a release gate. No promise of a production-ready ID resolver that invents IDs on reads.

## Required code-path inventory

Paths below are relative to the repository root. `Migrate` means membership/authorization/lifecycle behavior is in scope; it does not mean copying prototype implementations wholesale.

| Path / ingress | Classification and required work |
| --- | --- |
| `packages/db/schema.ts`, `migrations/`, `migrations/meta/_journal.json` | Migrate: additive Project/environment-membership schema and Project-scoped permission-group restriction, later constraints; preserve staging's dashboard migration. |
| `packages/db/scripts/migrate.ts`, `script-migrations/index.ts`, `script-migrations/types.ts` | Migrate integration: SQL runs before registered scripts under a session migration lock. This lock does not stop application writers. Do not put a large unbounded backfill in startup. |
| `apps/sim/lib/workspaces/create.ts` | Migrate both `createWorkspaceInTransaction` and wrapper; Project, membership and workspace created atomically. Its `createDefaultPersonalWorkspaceInTransaction` covers enterprise owner-claim provisioning. |
| `apps/sim/app/api/workspaces/route.ts` | Migrate normal POST and lazy/default workspace creation through a shared authorized application creation operation; preserve legacy wire behavior and existing workspace URLs. |
| `apps/sim/lib/workspaces/application/create-organization-workspace.ts`; `lib/mothership/application/execute-organization-workspace-use-case.ts`; `lib/mothership/tools/server/workspaces.ts` | Migrate shared lower creation path; keep Mothership a trusted adapter and preserve org pinning, capabilities, billing admission and resource refresh behavior. |
| `apps/sim/lib/billing/enterprise-owner-claim.ts` | Migrate inherited transaction behavior; no nested independently committing Project creation. |
| `apps/sim/ee/workspace-forking/lib/create-fork.ts`; `application/`; `lib/lineage/{lineage,lineage-root,unlink}.ts` | Migrate Project inheritance/validation under existing rank-ordered lineage and row locks. Disconnect atomically creates a new Project and reassigns the complete descendant subtree. Repeated/concurrent unlink must not create duplicate Projects; preserve existing edge-lock ordering and reread the closure. Do not add an organization lock held across the entire copy without reconciling lock order. |
| `apps/sim/app/api/workspaces/[id]/route.ts`; `lib/workspaces/lifecycle.ts` | Migrate required use-case boundaries; environment rename remains independent, DELETE is archive; guard last-active-environment removal. Add Project-wide atomic archive primitives while preserving existing resource archival/deactivation semantics and retryable effects. |
| `apps/sim/lib/workflows/lifecycle.ts` | Account-related bulk workspace archive must obey Project last-environment invariants; full Project archival must enlist workflow state in the same compound operation. Transfer surviving Projects on account deletion or use an explicit whole-Project lifecycle path. Workflow restore is not workspace restore. |
| `apps/sim/lib/workspaces/organization-workspaces.ts` | Migrate attach/detach closure, locks, Project scope and personal-owner transfer together with existing payer changes; include archived environments/Projects and report legacy empty-Project anomalies. |
| `apps/sim/lib/invitations/core.ts`; `lib/billing/organization.ts`; `app/api/v1/admin/organizations/[id]/members/route.ts`; `scripts/consolidate-users-into-organization.ts` | Required attach callers. Reuse corrected transaction primitive; recompute Project visibility/Issue eligibility after environment grants or scope changes. Do not broadly refactor v1 APIs. |
| `apps/sim/lib/billing/webhooks/subscription.ts`; `app/api/v1/admin/organizations/[id]/route.ts` | Required detach/cancellation/delete callers; explicit Project lifecycle before restrictive org FK. Preserve atomic detach+delete and billing semantics. |
| `apps/sim/lib/workspaces/admin-move.ts`; `admin-move-source-impact.ts`; `lib/admin/member-operation.ts`; `lib/billing/enterprise-provisioning.ts`; `app/api/v1/admin/dashboard/workspaces/[id]/move/route.ts` | Migrate transfer preflight/disclosure, Project conflicts and transaction ownership. Existing moves can dissolve fork edges; that alone cannot define Project transfer. Keep admin operation receipts and recoverable audit. |
| `apps/sim/lib/billing/organizations/membership.ts` | Migrate member removal, external removal, member transfer and organization-owner transfer to invalidate Project Issue eligibility and handle personal lifecycle ownership alongside workspace permission rows. |
| `apps/sim/lib/users/account-deletion.ts` | Migrate deletion planning/rechecks/transaction for retained Issue data, owned Projects and last-environment guards, transfers and Project FK restrictions. Direct workspace deletion uses alias `workspaceTable`; a search only for `delete(workspace)` misses it. |
| `apps/sim/lib/workspaces/{list,public-queries,host-context,seed-workspace-list}.ts`; `application/list-*.ts`; `packages/platform-authz/` | Preserve existing environment authority. New Project reads must not replace resource scope or turn Project membership into environment permission. Add owner-context resolution only where needed. |
| `apps/sim/lib/workspaces/application/{manage-permissions,remove-member}.ts`; `permissions/`; `access/workspace-access.ts`; invitations and organization member operations | Required access inventory. Reevaluate any/all environment access at invite/removal and update live Issue access; do not materialize permanent Project grants. |
| `apps/sim/app/api/v2/workspaces/**`; `lib/api/contracts/v2/`; `lib/api/mcp/generated/v2-operations.ts`; SDK/CLI generation | Preserve existing environment API. Project APIs are an additive surface after credential policy, using the same Project application operations. Regenerate descriptors only when adding that surface. |
| `apps/sim/app/api/v1/admin/workspaces/[id]/{import,export}/route.ts`; `lib/workflows/operations/import-export.ts`; `lib/workspaces/__integration__/mapped-import.integration.ts` | Reviewed scope: import works into an existing environment, not a new Project. Preserve identity and never import Project grants/IDs from resource payloads. No broad v1 migration. |
| `apps/sim/background/cleanup-soft-deletes.ts`; `lib/billing/storage/{payer-transfer,tracking}.ts`; `lib/mothership/inbox/{lifecycle,settings-store}.ts` | Reviewed adjacent writers: resource cleanup, payer/accounting and inbox settings are not Project identity changes. Project archive must invoke established environment/workflow deactivation; preserve existing retention policy and do not add immediate hard purge. No blanket edits to every workspace update. |
| `apps/sim/lib/permission-groups/{config-scope.server,resolve.server,fields,mutation}.ts`; `application/`; group contracts/settings UI | Extend Project-scoped partial-access Issue restriction through existing authorized group operations. Default absent setting to allow; preserve other fields on update; resolve all applicable groups using existing composition rules. Validate group/Project organization and invalidate Project Issue capabilities on edits. Read `add-permission-group-item` before implementation. |
| New `apps/sim/lib/projects/application/**`, contracts, internal routes, hooks | Implement fresh against staging shared foundations. Session operations first; add other adapters only with intentional Principal policy. |
| Prototype `lib/mothership/chat/lifecycle.ts`, `chat/application/fork.ts`, `chat/list-mothership-chats.ts` and `copilot_chat_project` | Non-goal: exclude chat relation imports, writes, filters, backfill and schema. Separate chat-ownership work removes obsolete prototype relations if ever deployed there. |
| Prototype `app/o/[organizationId]/p/hooks/use-projects.ts` and resource-browser/UI port | Defer: consume true Project IDs only after foundation. Extract final behavior later; no prototype cherry-picks. |

Implementation must repeat the write-ingress search after rebasing (including schema aliases/raw SQL, user cascades, scripts and fixture writers). This is a source-based inventory, not a claim that production rows already satisfy the invariants.

## Backfill and deployment procedure

### Expand and capture a plan

1. Ship additive Project and membership tables without enforcing membership completeness yet; keep current UI/API functional. Do not rewrite workspace names, routes, resource IDs or chat rows. Ship compatible writers in the same foundation release, but account for old replicas during rollout. Backfill activation and final constraints are separate deployment steps.
2. Use `packages/db/scripts/backfill-projects.ts`, with explicit `PROJECT_BACKFILL_DATABASE_URL`, `PROJECT_BACKFILL_REPORT_PATH`, and `dry-run` / `apply --from-file <plan> --database-id <fingerprint> --writers-drained`. Run with `bun --no-env-file` so a checkout’s `.env` cannot select the database. The operator must verify the supplied target; there is no implicit application-DSN fallback.
3. Scan all workspaces, including archived, in stable ID keyset pages. Discover graph components with cycle detection and bounded traversal; roots are rows with no parent, missing parents are reported, cycles and organization mismatches are blocking anomalies. Keep only one bounded family in memory. Committed Project and membership rows serve as the durable resume mapping. Never silently reconnect already detached lineages or group unrelated roots by equal name.
4. Group existing environments by their current fork connections. A root workspace and all forks still connected beneath it become one Project. For example, Production → Staging → Dev becomes one Project containing all three environments. If Staging was previously disconnected from Production, create two Projects: one for Production, and one for Staging plus Dev. A workspace with no connected forks gets its own Project. Each new Project uses the root workspace’s name plus “ - Project” and its `ownerId`.

   Preserve any valid Project assignment that already exists. If only some environments in the tree have been assigned to one compatible Project, add the remaining environments to that same Project. If the tree is assigned to multiple Projects or spans multiple organizations, report the conflict and leave it unchanged for review; do not automatically merge it.

   If all environments in the tree are archived, create an archived Project and use the most recent environment archive timestamp. Otherwise, create an active Project. Never reactivate an environment during migration. An existing Project with no environments is reported for repair because every Project must contain at least one environment.

5. Allocate each proposed Project ID in the completed dry-run artifact with `generateId()`. Apply consumes that artifact and validates its database identity and family fingerprints. Reruns use the same planned IDs, including after an interrupted apply; compatible existing assignments are reused. No extra manifest table is required.
6. Duplicate names are allowed; bound and trim seed names deterministically and record before/after. An ID collision fails the batch; never silently replace a planned ID during apply. Never overwrite an unrelated Project on collision. No Project-member/grant backfill; existing groups gain an absent/default-allow restriction without changing existing settings. No chat backfill, no Issue backfill in this PR.

### Coordinate writers and commit batches

7. Before apply, drain old app/worker/script writers or use a bounded write-maintenance window for the affected lifecycle operations. The migration runner lock serializes migration runners only. A one-shot script registered in the startup runner may finish before old replicas stop creating unassigned environments and is not a readiness signal.
8. New create/fork/attach/detach/move writers and the backfill must share a documented lock order. Integrate with existing organization, invitation, payer, lineage and workspace locks; do not introduce an opposite Project→organization order. Lock scope owners/Project/family according to that rank plan, then member rows in stable code-unit ID order, re-read closure and fingerprints under lock, and retry if scope changed. For fork versus bulk attach/detach, the closure must be re-read after serialization so a newly committed child cannot be omitted. If online closure coordination cannot be proved, use the maintenance window for those operations.
9. Each normal family commits Project + all environment assignments atomically. Insert membership only for unassigned workspaces; a unique-workspace conflict requires a locked reread and validation of the expected Project, not silent success. Do not ignore unique conflicts. Keep counters/report progress after commit; counters must describe committed work.
10. Bound batches by rows and transaction duration, not only 200 roots. Oversized families are explicitly reported and processed in a dedicated controlled transaction/window, or through a staged assignment design whose incomplete state is hidden from Project consumers. Never expose a partially migrated Project as complete. Resume from the original dry-run plan and committed memberships; recover committed batches after process death without new IDs or accidental policy restrictions.
11. Keep legacy workspace UI operational while Project/Issues reads are release-gated until readiness. During rolling deployment a missing membership is an explicit not-ready state, not permission to create a new Project on a GET. A compatible fork writer must ensure its parent family transactionally, or temporarily refuse fork creation for an unassigned family.

### Validate and enforce

The command must emit counts and offending IDs for at least these checks (illustrative SQL for the proposed schema):

```sql
-- Must be zero before exactly-one enforcement.
SELECT w.id FROM workspace w
LEFT JOIN project_workspace pw ON pw.workspace_id = w.id
WHERE pw.workspace_id IS NULL;

-- Must be zero; use null-safe comparison for personal scope.
SELECT w.id, pw.project_id FROM workspace w
JOIN project_workspace pw ON pw.workspace_id = w.id
JOIN project p ON p.id = pw.project_id
WHERE w.organization_id IS DISTINCT FROM p.organization_id;

-- Existing fork edges must stay in the same Project.
SELECT child.id FROM workspace child
JOIN project_workspace child_pw ON child_pw.workspace_id = child.id
JOIN project_workspace parent_pw ON parent_pw.workspace_id = child.forked_from_workspace_id
WHERE child_pw.project_id IS DISTINCT FROM parent_pw.project_id;

-- No active Project may lack active environments.
SELECT p.id FROM project p
WHERE p.archived_at IS NULL AND NOT EXISTS (
  SELECT 1 FROM project_workspace pw JOIN workspace w ON w.id = pw.workspace_id
  WHERE pw.project_id = p.id AND w.archived_at IS NULL
);

-- Even archived Projects retain at least one environment row.
SELECT p.id FROM project p WHERE NOT EXISTS (
  SELECT 1 FROM project_workspace pw WHERE pw.project_id = p.id
);

-- Every Project retains a user lifecycle owner.
SELECT id FROM project
WHERE owner_id IS NULL;

```

Additionally validate FK orphans, cycles/missing parents, duplicate/partial manifest assignment, permission-group Project/organization mismatches, counts of archived environments, empty Projects, source permission changes since planning, and no Project membership implied by chat data. Empty Projects and active Projects with no active environments are blocking anomalies; repair them explicitly, never silently delete retained Issues. Duplicate names and fully archived Projects with retained environments are valid. Check plan/report counts against actual committed rows and ensure every blocked family is resolved before completion.

12. After compatible writers are fully deployed and validation passes, add/validate constraints, enforce exactly-one membership, and enable consumers. Use staged `NOT VALID` validation for existing-row constraints where appropriate; lock-time-bounded DDL and staging's documented concurrent-index mechanism for large workspace indexes. A cross-table deferred trigger must validate both workspace and Project ownership updates and serialize conflicting writes; test concurrent transactions, not just final-state SQL. Ordinary FKs still own referential existence.
13. Repeat validation after a normal write interval. Confirm a fresh install and an upgraded self-hosted database reach the same ready state. An operator-run production backfill needs a documented self-hosted upgrade path; readiness must remain false until it completes. Do not silently hang all deploys on a production-sized graph scan.

### Recovery and rollback

Before enforcement/consumer activation, application rollback may ignore additive schema, but old writers require pausing the backfill and another reconciliation before reactivation. After exactly-one membership enforcement, rolling back to old writers is unsafe: they cannot create environments. Roll back only to the compatible foundation release, or deliberately relax the constraint with writes gated and rerun reconciliation afterward.

Keep IDs, membership rows, and operator reports durable. If a backfilled grouping is wrong before Issues begins, correct it transactionally from the recorded mapping with an explicit reviewed repair. Once Issues reference a Project, do not undo by dropping Projects or regenerating IDs; use a forward repair with an explicit Issue retention/move decision. Preserve backups and reports. No automatic destructive down migration. Retry failed batches; committed family assignments survive. A script runner's completed-name marker is not a substitute for a row-level readiness check.

## PR and dependency sequence

| PR | Scope and dependency | Deploy boundary |
| --- | --- | --- |
| A — Project foundation | Clean implementation branch from fresh staging; schema expansion, environment-derived Project/Issue access and Project-scoped partial-access restriction, stable IDs and session contracts, shared creation/fork writes, required lifecycle compatibility, dry-run/apply tooling and focused proofs. No chat/UI. | Additive deployment; existing workspace UI works; Project consumer gate initially off. Project/environment placement are atomic. Required org/user lifecycle handling must not be deferred past activation. |
| B — migration enforcement | Depends on A: bounded apply runbook, validated data/readiness, constraints and activation. Can be a small separate PR/release, or a second deployment phase of A. | Must follow compatible-writer rollout and measured validation. No hardcoded success flag standing in for data integrity. |
| C — Issues | Issues stacks on A after access/lifecycle contract is agreed; merges against A and activates after B. Issue FK, application operations, routes and any feature UI independently reviewable; enforce the partial-access restriction across every Issue surface before enabling it. | Issue identity is Project ID; no environment-owner authorization fallback. |
| D — chat ownership | Independent of A/B/C. Org/personal chat ownership and resource browsing, with obsolete prototype Project references excluded. | No chat-to-Project relation or Project migration dependency. |
| E — remaining backend features | Resource-browser APIs, environment management and other feature foundations as separate PRs. Dashboards already exist in staging; do not reintroduce prototype migration. | Depends on A/B only where actual Project operations are used. |
| F — new organization/Project UI | Built on landed feature surfaces; extract completed behavior from the aggregate experiment. True Project ID and selected environment ID remain distinct. | Last; current workspace navigation remains supported until replacement is deliberately shipped. |

If A becomes too large, split a prerequisite shared authorization/closure-lock fix from the entity PR, then stack A on it. Do not split out required lifecycle writes such that an enabled Project entity can silently corrupt on cancellation, invitation acceptance or account deletion. A schema-only merge can be additive, but is not the complete foundation required by Issues.


## Verification plan and release evidence

Apply the `test-audit` authoring gate before code: enumerate failure modes, choose one strongest owner boundary, and avoid schema/registry/config assertions. Use disposable Postgres/Redis and an isolated app. Report to caller-supplied `PROJECT_FOUNDATION_REPORT_PATH` / `PROJECT_BACKFILL_REPORT_PATH` with each check's status, duration, failure and IDs; upload on CI failure.

| Real boundary | Failure to prove |
| --- | --- |
| Migration against pre-Project DB snapshot | Active/archived singleton, siblings, nested forks, detached family, duplicate names, mixed owners, missing parent, cycle, cross-org family, prior partial/split assignments. Valid rows map once; anomalies block without mutation; rerun uses identical IDs and preserves default-allow policy. |
| Real concurrent DB transactions | Fork versus backfill; fork versus attach/detach/move; whole-Project archive versus fork/environment/workflow creation; two concurrent last-environment removals; archive versus Issue write; environment access revoke versus Issue write; full-to-partial transition versus Issue write; restriction edits versus cached reads; crash between batches. Assert committed scope and recoverability, not mocked call order. |
| Real create/provision/fork HTTP or application boundary | Workspace+Project rollback together after injected transactional failure; regular creation, first visit, enterprise claim and org Mothership creation all obey membership. |
| Real Project/Issue HTTP | Staging-only grant shows the Project and only staging in its toggle, with production hidden; partial-access user sees all Issues by default and none with the applicable group restriction; full-access user retains Issues under that restriction; no-environment user gains nothing; restriction changes do not hide accessible environments; list/detail/search/counts/notifications/tools honor denial; cross-org assertion concealed; workspace API key rejected; archived Project read allowed/write denied; active empty Project creation/removal is rejected; archived-state checks cannot grant access through an empty set; revocation effective without stale authorization cache. |
| Lifecycle E2E | Independent renames; disconnect creates one new Project for the complete subtree, retains original Project ID, and leaves existing Issues in the original Project; individual archive/delete of last environment is rejected; whole-Project archive covers every environment/workflow atomically and retains Issues; org cancellation/delete produces approved personal ownership or atomic refusal; user deletion handles retained Issues and last-environment invariants; transfer rollback preserves billing and scope. |
| Current UI compatibility | Existing workspace URLs, resource execution and import/export still work; no chat migration; Project selection cannot choose an execution environment implicitly. |
| Upgrade/install | Fresh install, interrupted backfill resume, rolling old/new writers before enforcement, enforced-release rollback boundary and self-hosted completion path. |

Extend existing real suites where they own the failure: `lib/workspaces/__integration__/fork-sync.integration.ts`, `http-cli.integration.ts`, `mapped-import.integration.ts`, and `ee/workspace-forking/lib/lineage/fork-lock-order.integration.ts`; read their full coverage before deciding on additions. Project authorization and migration have new independent contracts and need real owner-boundary proofs. Existing type checks cannot prove concurrent ownership integrity. Demonstrate regressions go red with each relevant guard removed; never add a test that only restates a table definition.

Implementation checks: relevant integration/E2E runs; workspace type-checks (app/db/auth/platform-authz as touched); `bun run check:api-validation:strict`; `bun run check:audits`; repository lint with review of autofixes; `git diff --check`. Local validation now includes 35 foundation/fork/lifecycle integration tests, 9 dedicated backfill/CLI integration cases, app/database type checks, lint, all 57 audits and diff checks. A negative control confirmed the changed-family guard catches a newly added descendant. These checks do not represent full coverage of every future-consumer scenario in the matrix above. No hosted backfill, browser rehearsal or production activation has occurred.


### Ownership clarification during implementation

Every Project retains a required `ownerId`, including organization Projects. `organizationId` is optional; the two fields are not mutually exclusive. This matches workspace lifecycle ownership. Neither field substitutes for explicit workspace grants or organization-admin authority. A departing owner is transferred before account deletion; Project ownership does not cascade away with a user. Organization detachment keeps Project identity and explicitly assigns its personal lifecycle owner.


## Concrete implementation and rollout notes

The schema contains `project` (`id`, `name`, required `ownerId`, nullable `organizationId`, `archivedAt`, `createdAt`, `updatedAt`) and `project_workspace` (`projectId`, unique `workspaceId`, `createdAt`). There is no stored fork depth, position, or Project billing state.

Implemented session routes:

- `POST /api/projects`: creates a named Project and its named first environment atomically, including admin permissions and a starter workflow. Requires explicit `organizationId` (or `null` for personal scope), `name`, and `initialEnvironment.name`; returns both IDs and names with HTTP 201. Uses existing workspace creation eligibility, billing and permission-group rules.
- `GET /api/projects`: authorized, cursor-paginated active Project inventory.
- `GET /api/projects/[id]`: metadata, accessible active environments, and administration/Issues capabilities.
- `GET /api/projects/by-workspace/[workspaceId]`: canonical lookup that also authorizes the requested environment.
- `PATCH /api/projects/[id]`: rename.
- `DELETE /api/projects/[id]`: compound Project/environment/workflow archive.

Workspace creation creates its Project atomically; fork creation joins the existing Project. Existing workspace creation callers retain their response shape and generated Project names. Project creation shares their transaction primitive; it cannot attach an arbitrary environment or create an empty Project. A separate empty-Project create, arbitrary environment attachment, restore UI, public-key API, and Issues CRUD are not implemented here. The existing permission-group editor gains the Project Issues restriction; the new Project navigation UI remains a separate consumer.

`deniedPartialAccessProjectIssues` is a Project-ID denylist on existing permission-group config. An empty list allows access. For a partial-access teammate, each accessible active environment resolves its effective group using existing explicit-member/all-members/default precedence. If any of those effective groups denies this Project, all Issues are denied. The selected environment cannot change the answer. Archived environments are excluded from this comparison. Full-access teammates bypass this partial-access restriction. Issue use cases call `authorizeProject` in their own transaction before reading or writing Issue rows; `getProjectIssueAccess` is only a read-only probe. The Issue gate holds the permission-group lock through that transaction, so callers must respect its existing leaf-lock rule.

Disconnect copies a matching restriction to the new Project. Moving a Project out of an organization removes its stale ID from that organization’s group configs. Rename/archive authorization includes every environment, including archived members. A departing organization member’s Project lifecycle ownership moves to the organization owner. Account teardown transfers surviving Projects to an administrator of their surviving environments and explicitly removes wholly private Projects in the same teardown transaction; it cannot leave a surviving active Project with no active environment.

The backfill scans 100 workspaces per page, limits ancestor traversal to 1,000 links and CLI family batches to 1,000 environments by default (10,000 maximum), and commits one family at a time. It reports cycles, missing parents, oversized families, cross-organization lineages, conflicting assignments and inconsistent archive states. A reserved session advisory lock excludes overlapping backfill runs. Apply takes bounded NOWAIT table locks before rediscovering and validating the full family. Organization moves use a nonblocking Project lock because their legacy paths can already hold workspace locks; contention returns a retryable conflict. A conflicting batch leaves prior committed families intact and is safe to rerun after repair.

Operator sequence:

1. Deploy the additive migration and compatible writers. Do not enable downstream Project/Issues consumers yet.
2. Run dry-run with an explicitly verified database target and inspect its report.
3. Drain old writers and pause lineage/ownership maintenance while applying. Pass `apply --from-file <plan> --database-id <fingerprint> --writers-drained`; this flag is an operator assertion, not an automatic drain. Legacy unassigned workspaces remain usable, but their fork operation returns a backfill-required conflict until assignment completes.
4. Rerun and verify zero new assignments and zero conflicts, then execute the reconciliation queries in this plan. Resolve any remaining unassigned/empty/mismatched rows before activation.
5. Enable consumers only after reconciliation. Complete database-level membership/minimum-environment enforcement in a later deployment, as recorded by `contract-pending` in the schema. Do not activate consumers on old-writer rollback without another reconciliation.

Example invocation from the repository root (supply the target URL through your normal secret mechanism):

```sh
PROJECT_BACKFILL_REPORT_PATH=/absolute/path/project-backfill-dry-run.json \
bun --no-env-file packages/db/scripts/backfill-projects.ts dry-run

PROJECT_BACKFILL_REPORT_PATH=/absolute/path/project-backfill-apply.json \
bun --no-env-file packages/db/scripts/backfill-projects.ts apply \
  --from-file /absolute/path/project-backfill-dry-run.json \
  --database-id <fingerprint> --writers-drained
```

Validation artifacts come from `PROJECT_FOUNDATION_REPORT_PATH` (or `apps/sim/test-results/project-foundation.json`) and the integration runner’s JSON report. CI already uploads `apps/sim/test-results/*.json`. The former mock-count workspace lifecycle tests were replaced by real database checks of concurrent removal and retry repair. The dedicated backfill suite executes the exact additive migration in a disposable database before exercising backfill. External webhook/socket/MCP cleanup retains existing best-effort post-commit behavior; durable archive state commits atomically.

The operator-run CLI procedure, self-hosted commands, SQLSTATE handling, lock behavior, report interpretation and repair procedure are documented in [the Project backfill runbook](./project-backfill-runbook.md).

### Follow-up: Project-scoped files

Project names provide the identifying label; this foundation intentionally omits a separate description field. Shared purpose, goals, and operating guidance belong in Project-owned files, with a designated brief identified by a stable document ID.

Extend file ownership to Projects in a separate PR, likely with nullable `projectId` on the existing files table and constraints for valid scope combinations. Include authorization, version history/collaboration, storage lifecycle, and Mothership tools/VFS support. Keep environment files restricted to their environments; publishing them to a Project must explicitly account for broader readership. Project-scoped files and brief consumption are not implemented in this foundation.
