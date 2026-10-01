# Retire indexed Search data without a bulk rebuild

This is an **operator-run workflow**, outside `db:migrate`, `db:push`, deployment jobs, cron, and
Trigger.dev. Merging or deploying the code starts no copy, deletion, vacuum, or reindex. Deploy the
indexed-Search code removal first, verify every app/worker uses live Search, and drain old indexing,
projection-maintenance, and cleanup commands. Do not roll back to an indexed-Search release during
or after retirement.

The command replaces only `embedding_search`. It reconstructs ordinary-KB candidate vectors from
canonical `embedding` rows, including rows missing from the old deferred projection. Full-precision
vectors, content, keyword search, document ACLs, provenance and table identities used by ordinary KBs
remain in place. Search KB shells and source/credential configuration remain because live Search
uses them. Search chunks are deleted only after replacement cutover and a separate approval to
retire the old projection. Search documents are excluded/disabled and dispatch tokens cleared;
documents/files are not hard-deleted. Their eventual deletion must use the storage-outbox/accounting
path, not raw SQL.

This reduces risk; it cannot guarantee zero latency impact. Shadow inserts still build HNSW links,
consume CPU/I/O, and emit replicated WAL. Change capture adds a small write to each affected chunk
transaction while copying. Relation DDL can briefly exclude conflicting operations, and replayed DDL
can conflict with replica queries. Health sampling cannot react to a spike that begins inside a page.
Start with a canary page and prioritize serving traffic over migration speed.

## Release and operator sequence

1. **Deploy the code-removal PR first.** Deploy this stacked PR only after its parent. The command
   requires an explicit `--ack-release-drained` for preparation and cutover. It cannot prove which
   application binaries or external jobs remain running; verify that outside PostgreSQL.
2. **Rehearse on a disposable database**, using the current schema and realistic retained-vector
   widths. Run the integration suite, then ordinary-KB retrieval and live Search smoke tests against
   the staged application. Configure a dedicated maintenance role and primary direct/session-pooled
   connection. PostgreSQL 17+ is required for the transaction deadline. Never use transaction pooling.
3. **Configure health collection and disk/WAL headroom.** Feed fresh primary, every serving replica,
   and application SLO observations into the health file described below. Establish normal baselines;
   choose numeric limits from those baselines and provision space for old and new projections plus
   WAL. Merely having space for the final table is insufficient. Do not refresh a stale metric's
   timestamp or manufacture healthy samples. No valid fresh sample means no maintenance.
4. **Prepare and canary.** `prepare` creates a logged empty replacement with the six shared HNSW
   indexes already present, installs capture, and creates durable state. `run` advances one small page
   by default. Inspect application latency, query errors, CPU/I/O, WAL and every replica after the
   first pages. Leave the health collector's maintenance switch off when attention or headroom is
   unavailable. Increase only the number of scheduled bounded invocations once impact is acceptable.
5. **Copy, catch up and verify.** Continue `run` until `ready`. Each page commits with its cursor;
   retries resume committed work. Validation compares retained identities, enabled state, binary
   compatibility and vector values in both directions. Concurrent canonical writes enqueue IDs with
   generations; catchup acknowledges only the generation it processed. Metadata changes during
   construction invalidate the copy instead of silently changing its scope. Abort and prepare again
   after investigating. Do not change the schema or run other index maintenance during this workflow.
6. **Cut over explicitly.** First verify replicas have replayed the copy and drain old snapshots on
   primary and replicas, or divert replica reads and wait for existing transactions to drain. The
   collector's separate `cutoverAllowed` must attest this. Run a fresh bounded catchup page if changes
   remain, then `cutover`. It checks relation ownership/privileges, known writer triggers, dependencies
   and indexes, and uses `LOCK ... NOWAIT`. It refuses busy tables or old primary transactions rather
   than cancelling traffic or waiting in a DDL lock queue. Refusal is expected on busy systems: stop,
   inspect, and retry in a suitable window. Do not automatically loop cutover attempts.
7. **Observe before allowing deletion.** Verify ordinary-KB semantic/keyword retrieval, document ACL
   denials, connector ingestion/deferred repair, live Search, and error/replica metrics. The retained
   old projection is an observation backup, **not an instant rollback**: new writes target the new
   table. Never swap a stale backup back into service. A rollback requires a separately validated
   reconstruction from canonical embeddings, which remain intact at this point.
8. **Retire the backup, then purge slowly.** `begin-purge --ack-retire-backup` requires separate
   cutover clearance. It drops the old projection with `RESTRICT` before canonical chunk deletion,
   so its outgoing FK cannot maintain the old HNSW graph on each delete. Continue bounded `run`
   invocations until `finalize`. Every destructive page locks/rechecks Search markers. Ordinary rows
   and live configuration are preserved. Existing keyword/provenance FKs still perform bounded
   per-chunk cleanup. These indexes have a cost; leave telemetry gates enabled throughout.
9. **Finalize explicitly.** Clear another primary/replica DDL window and run `finalize`. It removes
   the capture triggers only after checking for late writes. If it returns `purge`, resume bounded
   pages and revisit this gate. Backup removal, abort and finalization may require implicit PostgreSQL
   lock upgrades: those waits are capped at 1 ms, but a brief lock queue is still possible.
10. **Verify completion.** Inspect the durable status, smoke-test retrieval again, and observe normal
   autovacuum/replica recovery. The fresh vector projection needs no final rebuild. Ordinary vacuum
   can reuse dead canonical/keyword heap space; it does not promise to shrink files. This command
   does not run `REINDEX`, `VACUUM FULL`, or an unbounded final absence scan.

## Commands

Supply the migration writer DSN through `MIGRATION_DATABASE_URL` in the process environment. There
is no fallback to the app DSN. The command uses one connection with
`application_name=sim-search-data-retirement`; configure a provider Traffic Control budget for that
application name when available. Keep credentials, provider identifiers, policy and health files
outside the repository.

```sh
bun --no-env-file packages/db/scripts/retire-indexed-search.ts --help
bun --no-env-file packages/db/scripts/retire-indexed-search.ts identity
bun --no-env-file packages/db/scripts/retire-indexed-search.ts status

bun --no-env-file packages/db/scripts/retire-indexed-search.ts prepare \
  --ack-release-drained --health-file /secure/health.json --health-policy /secure/policy.json

# One page by default. More pages remain bounded and health is checked before each one.
bun --no-env-file packages/db/scripts/retire-indexed-search.ts run \
  --health-file /secure/health.json --health-policy /secure/policy.json --pages 10 --seconds 60

# Separate operational decisions; never put these in an automatic run loop.
bun --no-env-file packages/db/scripts/retire-indexed-search.ts cutover \
  --ack-release-drained --health-file /secure/health.json --health-policy /secure/policy.json
bun --no-env-file packages/db/scripts/retire-indexed-search.ts begin-purge \
  --ack-retire-backup --health-file /secure/health.json --health-policy /secure/policy.json
bun --no-env-file packages/db/scripts/retire-indexed-search.ts finalize \
  --health-file /secure/health.json --health-policy /secure/policy.json

# Before cutover only: stop capture and discard this replacement after a NOWAIT lock attempt.
bun --no-env-file packages/db/scripts/retire-indexed-search.ts abort
```

`status` is read-only and never initializes work. Ctrl-C or connection loss leaves committed pages
intact; an interrupted transaction rolls back its writes and cursor together. Any database error,
health refusal, or capacity throttle stops the invocation with a nonzero exit code. No automatic
retry widens a page or raises a timeout. Check status before retrying an ambiguous connection loss.

The default page is 25 source rows; copying/validation can be explicitly lowered or raised to at
most 100. Destructive pages never exceed 25 source rows. IDs/vectors remain in PostgreSQL except a
bounded queue page of IDs/generations. The CLI runs at most 120 pages/600 seconds per invocation,
with at least five seconds and nine times the previous page duration between pages. The time budget
stops *starting* pages; the last transaction and cooldown can finish afterward. Core transactions
have short statement, lock, and transaction deadlines. There is no dynamic batch growth. A metadata
swap does no bulk data work while it holds locks.

Pausing the worker does not stop change capture. If a pause will be long, or the dirty queue itself
causes pressure, use `abort` before cutover. Capture must never reject application writes merely
because its queue grew. Monitor its storage too. A dedicated Traffic Control budget is an additional
backstop; an external scheduler may repeat bounded `run` commands, but must never repeat cutover or
begin-purge or finalize automatically. Trigger.dev is optional orchestration, not a substitute for these guards.

## Health contract

The repository deliberately has **no fabricated provider-health fallback**. A trusted external
collector must atomically replace an at-most-8-KiB UTF-8 JSON file. Its observation time is the oldest
underlying required metric timestamp, not the time it wrote the file. Aggregate worst lag/CPU across
all relevant nodes and minimum free storage. Require application SLO/error checks as part of
`healthy`; a successful database ping or static `/api/health` response is insufficient.

Required sample fields:

| Field | Meaning |
| --- | --- |
| `observedAt` | UTC ISO timestamp, seconds or three-digit milliseconds, ending `Z` |
| `databaseId` | Output of `identity`, SHA-256 of endpoint/port/database/role, excluding password |
| `healthy` | Collector verified the expected node inventory and application SLOs |
| `maintenanceAllowed` | Operator/alert kill switch; false stops the next page |
| `cutoverAllowed` | Separate confirmation that serving replicas and old snapshots are safe for DDL; normally false |
| `replicaLagBytes`, `replicaLagSeconds` | Worst replay backlog/lag across every serving replica |
| `walBytesPerSecond` | Measured WAL generation rate over a defined recent interval |
| `databaseP95Ms`, `cpuPercent`, `freeStorageBytes` | Current workload latency, worst CPU, and minimum available storage |

The policy file has exactly `databaseId`, `maxReplicaLagBytes`, `maxReplicaLagSeconds`,
`maxWalBytesPerSecond`, `maxDatabaseP95Ms`, `maxCpuPercent`, `minFreeStorageBytes`, and
`maxSampleAgeMs`. Supply finite numeric limits chosen for the deployment, not strings. Lag limits may
be zero; other limits must be positive, CPU at most 100, and sample age at most 30,000 milliseconds.
Missing/unknown fields, nonfinite/negative metrics, wrong identity, stale/future observations,
unhealthy/refused maintenance, or exceeded limits fail closed. There is no `--force` bypass.

PlanetScale's metrics API exposes replica lag, retained WAL, CPU and query latency/error series, but
collector mapping and freshness must be verified against the actual deployment. Retained WAL bytes
are **not** automatically replica replay backlog or WAL generation rate. If telemetry resolution or
permissions cannot satisfy the contract, keep maintenance paused and improve collection; do not fill
missing measurements with zero. Primary transaction visibility requires sufficient statistics
permissions; cutover refuses to infer safety from a partially visible activity view.

## Compatibility and follow-up contracts

The replacement retains nullable legacy source/ACL and binary columns because the deployed shared
projector still writes them. It preserves the ordinary shared vector indexes and matching query
shape, omitting source-specific/ACL indexes from the replacement. The old primary table and its
unused indexes are reclaimed together when the operator ends backup retention.

This workflow leaves legacy keyword tables, activity tables, shared dirty-queue state and historical
migration receipts in the schema. Search chunk deletes remove their referencing projection rows;
removing the empty tables, obsolete trigger installers and compatible columns is a later schema
contract after all remaining shared writers are removed. The complete inventory is in
[Indexed Search retirement inventory](../script-migrations/indexed-search-retirement.md). Never drop
canonical document ACLs or ordinary-KB content projections just because indexed Search is retired.

The runner owns `search_retirement_*` and `embedding_search_retirement_*`; Drizzle push excludes
those objects. `db:push` refuses databases with retirement state, including completed jobs, because
its historical reconcilers would recreate the retired writers and backfills. Use reviewed versioned
migrations after starting retirement; do not delete the receipt to bypass this guard. Existing `search_embedding_cleanup_*` checkpoints remain unchanged. Its progress-row
fence prevents the old cursor command from advancing while replacement work exists. Stop old
maintenance binaries first; this cannot prevent an arbitrary operator from issuing SQL independently.

## Verification and references

`packages/db/maintenance/search-retirement.integration.ts` exercises the real PostgreSQL boundary.
The integration reporter writes to `INTEGRATION_REPORT_PATH` (default
`test-results/integration.json`, uploaded by CI). The health boundary has separate invalid-input and
admission tests. Rehearsal against the running app and production-shaped workload remains an operator
prerequisite, not a claim made by these small fixtures.

- [pgvector HNSW](https://github.com/pgvector/pgvector#hnsw): empty indexes are supported; incremental building trades throughput for bounded work.
- [PostgreSQL locks](https://www.postgresql.org/docs/17/sql-lock.html) and [MVCC caveats](https://www.postgresql.org/docs/17/mvcc-caveats.html): fail-fast locking and old snapshots both matter.
- [Hot standby conflicts](https://www.postgresql.org/docs/17/hot-standby.html#HOT-STANDBY-CONFLICT): primary DDL may affect replica queries.
- [PlanetScale metrics API](https://planetscale.com/docs/api/reference/get_branch_metrics) and [Traffic Control](https://planetscale.com/docs/postgres/traffic-control/concepts): external observations and supplementary workload budgets.
