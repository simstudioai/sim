# Project membership storage and rollout

## Current decisions

Each workspace belongs to one Project through `workspace.project_id`; one Project can
contain many workspaces. The connector is temporary migration evidence, not the final
relationship. `project.updated_at` remains ordinary Project-record metadata, not a
workspace activity counter or a concurrency version.

Application transactions own Project creation with its first workspace, empty-Project
prevention, archive lifecycle, workflow admission/restoration, and subtree disconnection.
Keep their Project, lineage, edge, and workspace locks. These responsibilities no longer
require permanent lifecycle/count/workflow validation triggers.

Release 2 uses native composite foreign keys for the two structural invariants:

- Workspace and Project organizations agree, including personal (`NULL`) scope. Both
  tables have a stored generated `organization_scope_key`: `personal` for NULL and
  `organization:` followed by the organization ID otherwise. The key cannot be supplied
  independently by application writers. A unique Project `(id, organization_scope_key)`
  index supports the workspace `(project_id, organization_scope_key)` foreign key.
- A connected fork and its parent share a Project. A unique workspace `(id, project_id)`
  index supports `(forked_from_workspace_id, project_id)` referencing that pair. The
  existing parent-ID foreign key retains `ON DELETE SET NULL`; it clears only the parent
  pointer. The composite check uses deferred `NO ACTION`, not cascading Project moves.

The composite constraints are `DEFERRABLE INITIALLY DEFERRED` so a transaction can move
an entire subtree or organization before validation. The ordinary required Project-ID
foreign key remains restrictive. Projects may contain disconnected roots; connected
membership does not imply one tree per Project.

These native constraints supersede the custom Project integrity triggers, their advisory
lock wrappers, row-version dispatch, and `UPDATE project SET updated_at = updated_at`.
PostgreSQL owns referential-integrity concurrency; application business locks remain.
Drizzle records the columns, indexes, and FK relationships. The shared finalizer sets
deferred timing after fresh schema push because Drizzle does not represent that timing.

## Two releases

1. #8830 adds nullable membership and the authority marker. Connector-mode writes remain
   connector-only. Column-mode writes use the workspace column, with connector fallback
   only for unassigned legacy rows. It performs no bulk membership backfill.
2. After verifying incompatible membership-sensitive requests/workers have drained,
   #8590 switches authority, performs bounded backfill/reconciliation, validates native
   constraints, requires membership, and retires the connector. Its migration runs
   while #8830 is serving, before the new app is promoted.

The all-at-once traffic switch stops fresh requests to retired app servers. Remaining
in-flight operations and independently scheduled workers must be identified explicitly.
No new infrastructure maintenance mechanism, synchronization triggers, dual writes, or
extra compatibility release is required. After authority switches, #8830 is the oldest
supported application rollback; retain the column-phase marker and database changes.

On PostgreSQL 16/17, adding stored generated scope columns rewrites their tables. The
finalizer bounds the rewrite and refuses busy tables without waiting. A timeout leaves
the connector available and requires retry/capacity assessment, never a silent increase
in lock duration. Supporting unique indexes build concurrently; constraints install as
NOT VALID and validate before contraction. This is a bounded blocking schema operation,
not an online column addition with zero write interruption.

Backfill still verifies and repairs legacy lifecycle state before contraction. That
one-time migration prerequisite does not make lifecycle policy database-owned forever.

## Validation and downstream work

Use focused local Docker database checks and local HTTP servers: null scope transitions,
atomic transfers/subtree moves, parent deletion, stale snapshots/concurrent writers,
replay, schema push, application lifecycle, and the unchanged #8830 rollback runtime.
Run full CI only on GitHub Actions. Do not add Project-specific PostgreSQL 16 CI.

Changes to these decisions apply to both #8830 and #8590. Downstream #8609 and #8610
must retain the same storage boundary when synchronized; their separate worktrees are
not updated merely by updating this stack. Historical test reports prove earlier code,
not the current implementation or a requirement to preserve superseded trigger tests.
