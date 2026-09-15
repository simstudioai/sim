# Gradually draining retention cleanup

Use the existing authenticated GET endpoints through the cron Lambda. These parameters select a bounded run; the HTTP response is **202 Accepted**, not completion. It includes `runId` and the original accepted options. Inspect the Trigger.dev run and its `cleanup` metadata before invoking again.

## Invocation

First preview a small log batch with the existing Lambda event shape:

```json
{"path":"/api/logs/cleanup?workflowLogs=100&jobLogs=100&batchSize=25&dryRun=true&requestId=logs-preview-001"}
```

Then delete a small batch, using a new request ID:

```json
{"path":"/api/logs/cleanup?workflowLogs=100&jobLogs=100&batchSize=25&requestId=logs-delete-001"}
```

Start soft-delete parents smaller because they may have many children:

```json
{"path":"/api/cron/cleanup-soft-deletes?workflows=2&chats=5&legacyFiles=10&files=10&batchSize=1&dryRun=true&requestId=soft-preview-001"}
```

The Lambda already supplies the cron-secret authorization header. Direct HTTP calls use the same `Authorization: Bearer <CRON_SECRET>` header. Query parameters live inside `path`; no Lambda code change is needed.

### Limits

Each value is an integer from **0 to 5000**, shared across every workspace and organization in that run. Unspecified types have a zero budget. At least one limit must be positive.

| Endpoint | Limit parameters |
| --- | --- |
| `/api/logs/cleanup` | `workflowLogs`, `jobLogs`, `largeValues`, `legacyLargeValues`, `orphanSnapshots`, `staleReferences`, `staleDependencies`, `largeValueTombstones` |
| `/api/cron/cleanup-soft-deletes` | `workflows`, `chats`, `legacyFiles`, `files`, `knowledgeBases`, `folders`, `userTables`, `memories`, `mcpServers`, `workflowMcpServers`, `orphanKnowledgeBaseBindings` |

- `batchSize`: 1–500, default 25. Maximum root selections per batch; some operations use smaller statements.
- `dryRun`: `true` or `false`, default `false`. Counts distinct eligible roots without writes, storage deletion, billing changes, or backend calls.
- `requestId`: required, 1–128 letters/digits/underscores/hyphens. Reusing the same ID on the same endpoint returns the original run for seven days, even if parameters changed. Use a **new ID for every intended batch**, including switching from preview to deletion. After seven days, an old ID can start another run.
- Unknown, duplicate, blank, fractional, negative, or out-of-range parameters are rejected. Controls without a positive limit are rejected.

A call with **no query parameters retains the existing scheduled cleanup behavior**, including its larger budgets. Existing retention windows, enterprise overrides, paused execution/reference protection, and the retention feature gate still apply. There is no bounded change to Copilot task retention.

## What the budget means

Limits count **selected roots**, including roots restored before deletion. They do not count all physical rows affected by foreign keys. Two workflows can cascade into thousands of blocks, edges, chats, and messages. Mandatory attached-file and backend cleanup follows selected parents even when its standalone type budget is zero. Knowledge-base deletion retains the existing document accounting and storage-cleanup outbox behavior. Its child changes and parent deletion share one locked transaction, as do folder re-rooting and deletion; a failure rolls all of them back.

`largeValues`/`legacyLargeValues` count object keys. `orphanKnowledgeBaseBindings` counts bindings soft-deleted after object cleanup. Metadata pruning counts its selected metadata records. A dry run previews the current state; it does not reserve rows for a later deletion run.

## Run controls and results

- One coordinator walks owner scopes sequentially with shared budgets. It creates no child cleanup jobs.
- Logs and soft deletes share the named Trigger queue `retention-cleanup`, concurrency 1, including newly dispatched scheduled jobs. No per-type concurrency keys are used.
- Bounded dispatch sets one attempt and a 180-second hard maximum. The worker stops starting new root batches after 120 seconds; cancellable child preparation also observes that work deadline.
- Cleanup SQL uses transaction-local **500ms lock_timeout** and **5s statement_timeout**. The billable-file delete and storage decrement remain atomic. Orphan knowledge-base storage cleanup reuses the binding lock held by document creation, with a 15-second storage deadline. Large-value reference writers lock the value before registering references; cleanup locks and rechecks it before claiming a tombstone.
- Trigger `cleanup` metadata reports each requested type's `selected`, `deleted`, `skipped`, `filesDeleted`, and `filesFailed`, plus stage, duration, and stop reason: `budgets_exhausted`, `scopes_exhausted`, `time_budget`, or `failed`.
- A failure stops subsequent stages, preserves completed progress, and fails the run. External deletion is not transactional with Postgres. A hard process termination may leave the last metadata checkpoint behind actual effects. Do not blindly replay failed runs: inspect the failed stage and any external work already completed. Log and file storage is removed only for rows returned by the guarded delete. Their keys, and claimed large-value keys, enter `retention.storage.cleanup` outbox events in the same database transaction. The run attempts those events immediately; the existing outbox worker retries failures without selecting more roots. Inspect pending/dead-letter events when a run fails. Chat backend/storage cleanup still has its existing post-parent-delete recovery gap.

## Rollout

1. Deploy Trigger workers first, then the API. Keep the existing production cleanup schedules disabled. Ensure the existing outbox processor is running so persisted storage failures can retry.
2. Let old cleanup runs finish or cancel them before manual draining. Old queued jobs may retain their previous queue/version settings; the new queue cannot serialize against those runs.
3. Run a preview, then one small delete invocation. Wait for the Trigger run to finish. Check database CPU, query latency, lock waits, replication lag, and application errors against their normal baseline.
4. Repeat with a fresh request ID. Increase either the per-call budget or call frequency gradually, holding the other steady. Pause submissions on timeouts, failures, or database/application degradation. Avoid overlapping caller loops even though the Trigger queue serializes these jobs.
5. Once backlog and load are stable, re-enable schedules with **explicit bounded query parameters** and a fresh request ID per scheduled invocation. A fixed path containing a fixed ID will deduplicate for seven days; an unparameterized path uses the old larger cleanup behavior. Updating dynamic scheduled payloads is a separate rollout action.

## Validation

From `apps/sim`, run the bounded unit and route tests with Vitest. The isolated PostgreSQL suite deliberately skips app environment files and DB mocks:

```sh
DATABASE_URL=postgresql://bounded_cleanup@127.0.0.1:55439/bounded_cleanup_test \
  bunx vitest run --config lib/cleanup/vitest.postgres.config.ts
```

Use a disposable local database named `bounded_cleanup_test`. The suite creates and removes `cleanup_fixture_*` and minimal execution-retention fixture tables in that disposable database, and verifies cross-owner budgets, dry-run safety, cascades, restore races, partial commits, and local timeout settings.
