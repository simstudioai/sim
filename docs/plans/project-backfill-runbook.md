# Project backfill operations

The SQL migration creates empty Project tables during the normal migration job. This backfill is a separate post-deployment operation. It is not registered in the startup migration registry: old replicas are still serving when that registry runs.

## Operator execution

Run the CLI from an approved maintenance host or a one-off migration container matching the deployed application revision. There is no dedicated GitHub Actions workflow and no automatic migration-registry entry for this backfill. The normal deployment pipeline still applies the additive SQL migration.

Before apply:

- Finish deploying the compatible release, including draining old workers. Pause manual lineage/ownership maintenance and coordinate a window without concurrent deployments. Without a workflow wrapper, the operator owns these checks; the CLI does not verify ECS cutover or serialize deployment pipelines.
- Supply `PROJECT_BACKFILL_DATABASE_URL` through the approved secret mechanism. Use a direct session-capable primary connection, with no pooled application DSN fallback. Verify the environment and the fingerprint printed by `identity`.
- Use a persistent, writable report directory. Retain the exact code revision, dry-run plan, apply reports, verification reports and console output with the release record. Reports contain resource metadata and should have restricted access.
- Rehearse staging using the same command before production. This task has not executed a hosted backfill or established an existing maintenance host.

1. Run `dry-run` and inspect the JSON report: roots, environment IDs, planned Project IDs, proposed names, changes and conflicts.
2. Repair reported conflicts deliberately and produce a fresh dry run. Apply refuses incomplete or conflicted plans.
3. Run `apply --from-file <plan> --database-id <fingerprint> --writers-drained`. Keep the same reviewed code revision and original plan for retries. The acknowledgement does not stop writers; each transaction applies one planned family after checking for changes.
4. Run `verify` independently. Require `completed: true`, `ready: true`, zero conflicts and zero missing assignments. Apply success alone does not establish readiness.
5. Repeat verification after normal writes resume. Keep Project/Issues consumers disabled until reconciliation and the separately deployed database membership/minimum-environment constraints are complete. This command never flips an activation flag.

A canceled or failed apply may have committed earlier families. Retain its report and original dry-run artifact; reapply the same artifact after checking the failure. Existing matching planned IDs are reused. A changed code revision requires reviewing compatibility and normally a new dry-run plan. Never produce a new plan merely to hide an unexpected assignment.

## Safety and failure handling

- Dry-run and verify do not change database rows. All modes take a session advisory lock so two operator runs cannot overlap. The reserved connection and backend PID are checked before each batch; losing that connection stops the run.
- Discovery pages contain 100 workspace IDs. Each family defaults to at most 1,000 members at the CLI, with an explicit maximum of 10,000. Total discovery is capped at 250,000 workspaces; lineage ancestry is capped at 1,000 links. Oversized data needs a reviewed adjustment or separate migration, never an unbounded run.
- Apply takes `SHARE ROW EXCLUSIVE ... NOWAIT` locks on workspace, Project and membership tables before rediscovering the family. This excludes concurrent inserts/deletes/updates for the short transaction, including new descendants. Reads remain available. Busy writers cause immediate contention rather than an indefinitely queued lock. This is a maintenance operation: ordinary workspace writes can briefly wait while a batch holds its locks.
- A SHA-256 fingerprint covers the ordered environment records, including names, owners, organization, archive timestamps and fork connections. Any change since dry-run rejects that family. Existing Project assignments must match the planned Project ID. Existing names are retained.
- Reads retry transient connection/unavailability failures with bounded jitter. Writes retry only SQLSTATE `40001` (serialization), `40P01` (deadlock) and `55P03` (lock unavailable), at most three attempts. No connection-error write retry: the commit result may be unknown. Constraint errors, cancellation, statement timeouts and unknown errors stop the run.
- Lock timeout is 2 seconds; statements and transactions are capped at 30 seconds. PostgreSQL 17+ is required for the transaction timeout. Runtime is bounded between batches (default 10 minutes, maximum one hour), so the last transaction may finish after the budget. SIGINT/SIGTERM stop after the current transaction; forced termination rolls back an open transaction.
- Reports are replaced atomically before any write and after every committed family. Counts reflect acknowledged commits only. If the connection disappears at commit, counts can underreport; reconcile through the original plan and verification. A failed report write stops further batches; the last durable report remains available. Do not infer rollback from a missing final report.
- Reports distinguish planned counts in dry-run/verify from committed counts in apply. `completed` means the selected scan/plan was processed; `ready` is set only by successful verification. SQLSTATE is recorded without dumping database error payloads or credentials.

## Conflict repair

Report entries include the root/environment IDs, relevant Project IDs and reason. Examples:

- Multiple Projects in one connected family: inspect intended lineage and retained data; repair membership or disconnect the intended subtree transactionally. Never automatically merge Projects.
- Cross-organization lineage: resolve the workspace ownership/lineage first using the approved organization lifecycle operation.
- Changed family after dry-run: inspect the change, then produce and review a new plan.
- Empty Project or archive mismatch: determine the intended retained environments and lifecycle state. Do not silently delete Project data or unarchive environments.
- Cycle or missing parent: repair the fork connection before migration.

The runner does not repair anomalies on the operator's behalf. After repair, run dry-run and verify again. Membership uniqueness and foreign keys remain active throughout.

## Self-hosted execution

Use the migration image from the same release as the application, after all application/worker replicas run compatible code. PostgreSQL 17+ and a direct session-capable primary connection are required. Supply `PROJECT_BACKFILL_DATABASE_URL` through your deployment's secret mechanism; do not place it in shell history or command arguments. Mount a writable, persistent report directory owned by the container's non-root user.

Inside that image, the working directory is `/app/packages/db`:

```sh
bun --no-env-file scripts/backfill-projects.ts identity
PROJECT_BACKFILL_REPORT_PATH=/reports/plan.json \
  bun --no-env-file scripts/backfill-projects.ts dry-run
PROJECT_BACKFILL_REPORT_PATH=/reports/apply.json \
  bun --no-env-file scripts/backfill-projects.ts apply \
  --from-file /reports/plan.json --database-id <fingerprint> --writers-drained
PROJECT_BACKFILL_REPORT_PATH=/reports/verify.json \
  bun --no-env-file scripts/backfill-projects.ts verify
```

Override the migration container command for this one-off operation; do not change the ordinary `db:migrate` startup command. Apply the same report review, writer coordination, replay and activation rules above. Keep the original plan on persistent storage until verification and the release are complete.

## Local proof

`packages/db/scripts/project-backfill.integration.ts` creates a separate disposable database for every case, seeds a pre-Project fixture and applies the actual `0393` SQL. It exercises real SQL and the CLI, including interruption, conflicting writers, lost sessions, report failures and idempotent replay. The normal integration workflow discovers this file and uploads the integration JSON result. Never aim this test at an existing app database; the shared test-infrastructure validator restricts the target to a local test database.
