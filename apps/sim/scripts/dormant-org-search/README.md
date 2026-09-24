# Dormant organization search: database recovery runbook

Organization-level indexed search ("Sim Search" over an organization search index, `knowledge_base.is_search_index = true`) is dormant: live search answers those queries instead. An organization search index can hold most of the rows in `embedding`, `embedding_search` and `embedding_keyword_search`, and all of `embedding_keyword_tin`. That inflates the shared vector index (`embedding_search_512_cosine_hnsw_idx`) past memory and slows every workspace knowledge base search.

This runbook removes that data safely and in a way you can repeat and resume, then gives the space back. Run the steps in order. Every script **only reads unless `--execute` is passed**, logs what it would do, and is safe to re-run.

Placeholders: `<knowledge-base-id>` is the search index's `knowledge_base.id`; `<migrations-role-dsn>` is the connection string of the role that owns the knowledge tables (the migrations role). The scripts read `MIGRATION_DATABASE_URL`, then `DATABASE_URL`. The deletion script uses the app's database client, which reads only `DATABASE_URL`. So set `DATABASE_URL` to the migrations role for every step.

```sh
export DATABASE_URL='<migrations-role-dsn>'
cd <repo-root>
```

Run long steps in `tmux`/`screen` from a host close to the database, off-peak.

| Script | Step | Writes with `--execute` |
|---|---|---|
| `disable-tin-projection.ts` | 1 | drops the three Tin sync triggers, truncates `embedding_keyword_tin` |
| `restore-tin-projection.ts` | rollback | reinstalls those triggers from migrations `0019` + `0024`, optional backfill |
| `delete-search-index-documents.ts` | 2 | deletes the search index's connector documents and chunks, queues storage cleanup, resets connector cursors |
| `maintenance.ts` | 3 | `REINDEX INDEX CONCURRENTLY`, `VACUUM (VERBOSE, ANALYZE)` |

## 0. Preconditions

Do not start until all of these hold:

1. **The release with live search as the default is deployed** everywhere, and old app instances are drained. No deployed code path should read the organization index for a user query.
2. **The organization's connectors are paused.** Their processing queue is already cancelled. Step 2 refuses to run otherwise. Check:
   ```sql
   SELECT id, connector_type, status, member_sync_status,
          sync_lock_token IS NOT NULL AS content_sync_running,
          member_sync_lock_token IS NOT NULL AS member_sync_running,
          deleted_at, detached_at
   FROM knowledge_connector WHERE knowledge_base_id = '<knowledge-base-id>';
   ```
   Every row that is not deleted should be `paused` (or `disabled`), with neither sync running and `detached_at` NULL.
3. **The fill does not reach the index.** A release that carries the indexed search gate skips search-index rows in the `knowledge-projection-fill` pass while indexed search is dormant. On an older release, turn the flag off; otherwise the fill keeps marking documents of the index for the projector while you delete them.
4. The knowledge base is the one you mean:
   ```sql
   SELECT id, name, organization_id, is_search_index, deleted_at
   FROM knowledge_base WHERE id = '<knowledge-base-id>';
   ```
5. Record a baseline to compare against later:
   ```sql
   SELECT relname, n_live_tup, n_dead_tup, pg_size_pretty(pg_total_relation_size(relid)) AS size,
          last_autovacuum, last_vacuum
   FROM pg_stat_user_tables
   WHERE relname IN ('embedding', 'embedding_search', 'embedding_keyword_search',
                     'embedding_keyword_tin', 'document', 'knowledge_projection_dirty');
   SELECT count(*) FROM knowledge_projection_dirty;
   SELECT count(*) FROM outbox_event
   WHERE status = 'pending' AND event_type = 'knowledge.document.storage.cleanup';
   ```
   `bun apps/sim/scripts/dormant-org-search/maintenance.ts` (no flags) prints all of this plus index sizes, running vacuums and index builds.
6. A recent point-in-time-recovery window exists. Deleted documents come back only by resyncing the connectors or restoring from backup.

## 1. Stop maintaining the Tin keyword projection

`embedding_keyword_tin` is the BM25 (`tin` access method) projection. Only organization search indexes are projected into it. Three triggers keep it current inside writers' transactions:

| Trigger | Table | Installed by |
|---|---|---|
| `embedding_keyword_tin_sync` | `embedding` | `0019_tin_keyword_projection`, re-guarded by `0024_knowledge_projection_async` |
| `knowledge_base_keyword_tin_sync` | `knowledge_base` | `0019` |
| `embedding_keyword_tin_source_acl_set` | `embedding_keyword_tin` | `0021`, re-guarded by `0024` |

The script drops exactly these three and then runs `TRUNCATE embedding_keyword_tin`, all in one transaction. The table, its indexes, and the Tin SQL functions stay, so the schema and any code that references them remain valid.

```sh
bun apps/sim/scripts/dormant-org-search/disable-tin-projection.ts              # dry run: lists triggers, size
bun apps/sim/scripts/dormant-org-search/disable-tin-projection.ts --execute
```

- **Locks.** `DROP TRIGGER` and `TRUNCATE` take ACCESS EXCLUSIVE locks on `embedding`, `knowledge_base` and `embedding_keyword_tin`. A queued ACCESS EXCLUSIVE request blocks every later reader of that table while it waits. Each attempt therefore waits at most `3s` (`lock_timeout`) and then retries with backoff, for up to `--retry-budget-minutes` (default 20). Once it has the locks, it finishes in well under a second: truncate unlinks files and does not delete rows one by one.
- **The document ACL fan-out is left as it is.** `sync_projection_source_acl()` (the `projection_source_acl_sync` trigger on `document`, from `0024`) updates `embedding_search` and `embedding_keyword_tin` inline, in one function body. Rewriting it would fork `0024`'s SQL. Against an empty table, its Tin `UPDATE` is one probe of `embedding_keyword_tin_document_idx` that finds nothing.
- **The knowledge projector writes no Tin rows while indexed search is dormant.** An older release, or one with `SIM_SEARCH_LIVE=false`, still writes Tin for marked documents of any search index whenever the Tin functions exist. If rows reappear (`SELECT EXISTS (SELECT 1 FROM embedding_keyword_tin)`), another search index is being written; find it with `SELECT knowledge_base_id, count(*) FROM embedding_keyword_tin GROUP BY 1`.
- **Verify:**
  ```sql
  SELECT tgname, tgrelid::regclass FROM pg_trigger
  WHERE tgname IN ('embedding_keyword_tin_sync', 'knowledge_base_keyword_tin_sync',
                   'embedding_keyword_tin_source_acl_set');           -- expect no rows
  SELECT pg_size_pretty(pg_total_relation_size('embedding_keyword_tin')); -- a few pages
  ```
- **Do not** run `0019_tin_keyword_projection.ts` directly or `db:push` against this database afterwards. Both re-install the Tin triggers and backfill the whole projection. Recorded script migrations do not run again on deploy, so normal releases leave this state alone. A future script migration that re-runs `installKnowledgeProjectionAsync` would bring back only `embedding_keyword_tin_source_acl_set`, which fires only on Tin writes and is harmless.

### Re-enable Tin

```sh
bun apps/sim/scripts/dormant-org-search/restore-tin-projection.ts                       # dry run
bun apps/sim/scripts/dormant-org-search/restore-tin-projection.ts --execute             # triggers only
bun apps/sim/scripts/dormant-org-search/restore-tin-projection.ts --execute --backfill  # + refill
```

The restore calls `installProjection` from `0019` and then `installKnowledgeProjectionAsync` from `0024`, the same functions the migrations use. The Tin triggers come back exactly as the migrations define them, including the deferred-projection `WHEN` guard. The script then checks that all three exist. Triggers only project chunks written after they are installed, so the projection needs a **backfill** (`--backfill` runs `0019`'s paced keyset `backfillProjection`). With a large search index, backfilling into the live Tin index is slow. For a large refill, drop `embedding_keyword_tin_content_idx`, backfill, then run `bun packages/db/script-migrations/0019_tin_keyword_projection.ts` to rebuild the index concurrently.

## 2. Delete the search index's documents and chunks

```sh
# Dry run: guard checks, then the first 3 pages with their chunk counts. Nothing is written.
bun apps/sim/scripts/dormant-org-search/delete-search-index-documents.ts --knowledge-base-id=<knowledge-base-id>

# A short first execution, to measure throughput and watch the database:
bun apps/sim/scripts/dormant-org-search/delete-search-index-documents.ts --knowledge-base-id=<knowledge-base-id> --execute --max-pages=5

# The full run (stop any time with Ctrl-C; each page is its own transaction):
DB_APP_NAME=sim-dormant-org-search-delete bun apps/sim/scripts/dormant-org-search/delete-search-index-documents.ts --knowledge-base-id=<knowledge-base-id> --execute
```

Exit codes: `0` means it reached the end, or stopped at `--max-pages`. The last log line then gives the `afterId` to pass as `--after-id`. `1` means it failed (it logs the cursor it reached). `2` means a precondition refused the run; nothing after the check was written.

### What each page does

1. **Guard, re-read before every page.** The knowledge base must exist and have `is_search_index = true`. Every connector that is not deleted must be `paused` or `disabled`, and neither its content sync nor its member sync may hold a lease. A detached connector is refused outright, because its worker is turning those same documents into standalone uploads. If a connector resumes mid-run, the run stops before its next page.
2. **Storage backpressure.** If at least `--storage-cleanup-ceiling` (default 2000) `knowledge.document.storage.cleanup` outbox events are pending, the run waits 30 s and checks again until the outbox worker catches up.
3. **Next page.** The run reads the next `--page-size` (default 200) documents with `connector_id IS NOT NULL`, in id order after the cursor.
4. **Chunks.** It deletes the page's chunks in transactions of at most `--chunk-batch-size` (default 1000), each with `lock_timeout` 5 s and `statement_timeout` 60 s (`--lock-timeout-ms`, `--statement-timeout-ms`), pausing `--pause-ms` (default 250) after each.
5. **Documents, in one transaction.** This mirrors the app's connector cleanup worker (`lib/knowledge/connectors/deletion.ts`). It share-locks the knowledge base and re-checks `is_search_index`, then locks the page's documents `FOR UPDATE` so a late indexing commit can't slip in. It checks that no chunk remains; if one does, it deletes chunks again, up to 3 passes, then fails. Next it queues the storage cleanup intents with the app's own `enqueueKnowledgeStorageCleanup`, and deletes the documents.
6. **Retries.** A transient failure (lock or statement timeout, deadlock or serialization conflict, lost connection) retries that step in place with backoff, up to 8 times. Each step commits entirely or not at all, so a retry repeats nothing that committed.

### Why this is cheap for triggers, and why it does not flood the projector

Deleting fires **no row trigger** on these tables. The trigger inventory on `document`, `embedding`, `knowledge_base` and the projections has only `INSERT`/`UPDATE` triggers:

- the synchronous projection triggers `embedding_search_sync`, `embedding_keyword_search_sync`, and the dropped `embedding_keyword_tin_sync`
- the projection marks `embedding_projection_mark_insert` and `embedding_projection_mark_update`
- the source/ACL triggers `projection_source_acl_sync` and `*_source_acl_set`
- the secret-provenance demotions

As `0024` documents, "a delete marks nothing": the projections' rows go through `ON DELETE CASCADE` foreign keys in the deleting statement. For each chunk, the cascade is a primary-key delete in `embedding_search`, `embedding_keyword_search`, `embedding_keyword_tin` (empty after step 1) and `embedding_secret_provenance`. For each document, it is a primary-key delete in `knowledge_projection_dirty`, `knowledge_document_observation` and `document_secret_provenance`. So **no `knowledge_projection_dirty` marks are written**, and setting `sim.projection_mode` would change nothing, since it only guards insert and update triggers. The run logs the mark count before and after as a check.

Row deletes do not touch the HNSW or GIN indexes; their entries become dead until vacuum. That is why step 3 exists.

### Storage objects

Stored objects are cleaned up the way the app does it, not with raw bucket deletes. Each deleted document whose `file_url` names a `kb/` or `knowledge-base/` key with an active `workspace_files` ownership binding gets a `knowledge.document.storage.cleanup` outbox event, committed in the same transaction as the delete. The app's outbox worker then deletes the object. It re-checks ownership, content version and that no other document references the key, and soft-deletes the binding. Watch progress:

```sql
SELECT status, count(*) FROM outbox_event
WHERE event_type = 'knowledge.document.storage.cleanup' AND created_at > '<run-start>'
GROUP BY status;
```

**Left behind, by design** (the same as any app deletion):

- Objects of documents whose key has no active ownership binding. The run logs `Cannot queue knowledge storage cleanup without an ownership binding` with the document id. Clean these up only through the repair process in `lib/knowledge/documents/storage-cleanup.md` ("Previously orphaned files").
- Documents without a stored object (remote `file_url`) have nothing to clean.
- Events that exhaust their 48 attempts stay as `status = 'dead_letter'` with their last error, for recovery by an operator.

Source-connected documents are not metered as uploaded storage, so there is no storage-usage ledger to adjust. **Standalone uploads** (`connector_id IS NULL`) are billed storage. They are never selected here, and the final log line reports whether any remain; delete those through the app.

### What is kept, and why the connector cursors are reset

The **knowledge base row and its paused connectors are kept**: their configuration, credentials, members, permission snapshots and sync history. Re-enabling is then a matter of resuming the connectors, with nothing to set up again.

Every page that deletes documents also clears each stopped connector's listing state, in the same transaction, so a run stopped partway never leaves a connector that would skip what was already deleted. These are the columns the app clears when a connector must list everything again (an access-mode switch or a source change), plus the directory checkpoint and each member's retry time:

- `lastSyncAt`, `lastSyncDocCount`, `listingCheckpoint`, `directoryCheckpoint` and `memberTombstoneCursor` on `knowledge_connector`
- `listingCheckpoint`, `changeCursor`, `memberSyncedThrough`, `lastCompleteListingAt`, `lastListedCount` and `nextAttemptAt` (so every member is due) on its `knowledge_connector_member` rows

Without this, a resumed connector would sync incrementally from its old cursor ("changed since last sync"), skip directory reconciliation behind a `complete` checkpoint, or leave members waiting on a future retry. It would never re-list the documents deleted here, and the index would stay silently incomplete. Partition work rows (`knowledge_connector_partition`) belong to the old listing generation, and the next full listing replaces them. `--no-connector-reset` skips the reset. When a run finishes with no connector documents left, it resets once more to catch rows a page could not (for example a member added mid-run).

Each deleting transaction also re-decides the guard while holding the knowledge base and its connectors `FOR SHARE`. Resuming a connector or claiming a sync updates the connector row, so it waits for the page in flight to commit, and the next page refuses.

### Duration and monitoring

Throughput depends on chunk count, WAL volume and autovacuum. Measure it: the `--max-pages=5` run logs `elapsedMs` per page. Remaining time is about `(documents left / 200) × seconds per page`. Get the document count with `SELECT count(*) FROM document WHERE knowledge_base_id = '<knowledge-base-id>'`.

While it runs, watch:

- Replication lag and WAL generation. If lag grows, raise `--pause-ms` or lower `--chunk-batch-size`.
- `pg_stat_activity` for lock waits caused by the scripts. The postgres.js scripts connect as `application_name = 'sim-dormant-org-search-ops'`; the deletion runs on the app's database client, so start it with `DB_APP_NAME=sim-dormant-org-search-delete` to tell its sessions apart.
- Search latency: it should not get worse. Deletes do not touch the indexes.
- The storage cleanup backlog, which the ceiling bounds.

Autovacuum will start on the heavily deleted tables during the run. That is expected; step 3 handles what it cannot finish.

### Re-running and resuming

Re-running with the same arguments is always safe. Deleted documents are gone, so a fresh run from the start sees only what is left. `--after-id` only skips re-reading the already emptied range. A second run over an empty index reads one empty page, clears the already cleared cursors again (idempotent), and exits `0`.

## 3. Give the space back: reindex, then vacuum

After step 2, most entries in the listed indexes point at dead tuples. **Reindex first, then vacuum.** Vacuuming an HNSW index repairs the graph around every deleted element, so autovacuum on a heavily deleted `embedding_search` can run for a very long time (pgvector's docs: "Vacuuming can take a while for HNSW indexes. Speed it up by reindexing first"). `REINDEX INDEX CONCURRENTLY` builds a fresh index from live rows only, without blocking reads or writes. The vacuum afterwards then has almost nothing to repair.

```sh
bun apps/sim/scripts/dormant-org-search/maintenance.ts                                    # report
bun apps/sim/scripts/dormant-org-search/maintenance.ts --reindex=all                      # dry run: the plan
bun apps/sim/scripts/dormant-org-search/maintenance.ts --reindex=embedding_search_512_cosine_hnsw_idx --execute --maintenance-work-mem=4GB
bun apps/sim/scripts/dormant-org-search/maintenance.ts --reindex=embedding_search_acl_unfilled_idx --execute
bun apps/sim/scripts/dormant-org-search/maintenance.ts --reindex=embedding_keyword_search_content_idx --execute
bun apps/sim/scripts/dormant-org-search/maintenance.ts --reindex=emb_content_fts_idx --execute
bun apps/sim/scripts/dormant-org-search/maintenance.ts --reindex=embedding_search_document_lookup_idx --execute
```

`--reindex=all` runs those five in that order. Any other index of a maintenance table can be named (for example another HNSW width, or `emb_doc_id_idx`); the report lists sizes so you can decide. Run one index at a time and check the report between them.

- The session sets `lock_timeout = 0` and `statement_timeout = 0`, because a cancelled concurrent reindex leaves an invalid `<index>_ccnew` copy behind. The script drops such a leftover before rebuilding that index.
- `--maintenance-work-mem`: HNSW builds are much faster when the graph fits (pgvector reports `hnsw graph no longer fits into maintenance_work_mem` otherwise). Size it against the *new*, live-only index and the server's free memory. Don't exhaust the server's memory. `--parallel-workers=N` sets `max_parallel_maintenance_workers`.
- Disk: the new index is built next to the old one until the swap.
- Progress: `pg_stat_progress_create_index` (also in the report).
- A running non-wraparound autovacuum on the same table is cancelled by the reindex's lock request, as intended. A **wraparound** autovacuum (`pg_stat_activity.query LIKE '%to prevent wraparound%'`) does not yield. Let it finish, or cancel it and vacuum manually right after.

Then vacuum, **one table at a time**, largest first, off-peak:

```sh
bun apps/sim/scripts/dormant-org-search/maintenance.ts --vacuum=embedding_search --execute --maintenance-work-mem=1GB
bun apps/sim/scripts/dormant-org-search/maintenance.ts --vacuum=embedding --execute --maintenance-work-mem=1GB
bun apps/sim/scripts/dormant-org-search/maintenance.ts --vacuum=embedding_keyword_search --execute
bun apps/sim/scripts/dormant-org-search/maintenance.ts --vacuum=embedding_secret_provenance --execute
bun apps/sim/scripts/dormant-org-search/maintenance.ts --vacuum=document --execute
bun apps/sim/scripts/dormant-org-search/maintenance.ts --vacuum=knowledge_document_observation --execute
bun apps/sim/scripts/dormant-org-search/maintenance.ts --vacuum=document_secret_provenance --execute
```

A manual `VACUUM (VERBOSE, ANALYZE)` runs without autovacuum's cost-delay throttling and with the session's `maintenance_work_mem`. A larger value holds more dead tuple ids per index pass, so it needs fewer passes over every index. This is why a manual run finishes when autovacuum did not. It also refreshes planner statistics, which matter because the tables just shrank. Watch `pg_stat_progress_vacuum`: `index_vacuum_count` above 1 means `maintenance_work_mem` was too small for one pass. `VACUUM` does not shrink files; freed pages are reused by later writes. Do **not** use `VACUUM FULL`: it takes an ACCESS EXCLUSIVE lock and rewrites the table.

Finally, warm the rebuilt projection into cache: `bun apps/sim/scripts/prewarm-search-projection.ts`.

### Verify

```sql
-- Index sizes: the listed indexes should have shrunk roughly in proportion to the rows removed.
SELECT c.relname, pg_size_pretty(pg_relation_size(c.oid)), i.indisvalid
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname IN ('embedding_search_512_cosine_hnsw_idx', 'embedding_search_acl_unfilled_idx',
                    'embedding_keyword_search_content_idx', 'emb_content_fts_idx',
                    'embedding_search_document_lookup_idx');
-- No invalid leftovers:
SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE NOT i.indisvalid;
-- Dead tuples back near zero, last_vacuum set:
SELECT relname, n_live_tup, n_dead_tup, last_vacuum, last_autovacuum
FROM pg_stat_user_tables
WHERE relname IN ('embedding', 'embedding_search', 'embedding_keyword_search', 'document');
-- Nothing left of the index:
SELECT count(*) FROM embedding WHERE knowledge_base_id = '<knowledge-base-id>';
SELECT count(*) FROM embedding_search WHERE knowledge_base_id = '<knowledge-base-id>';
```

**Search latency.** Pick an ordinary workspace knowledge base, `<workspace-knowledge-base-id>`, and compare against the same query from before step 2:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM embedding_search
WHERE knowledge_base_id = '<workspace-knowledge-base-id>' AND enabled
ORDER BY vector_512 <=> (SELECT vector_512 FROM embedding_search
                         WHERE knowledge_base_id = '<workspace-knowledge-base-id>'
                           AND vector_512 IS NOT NULL LIMIT 1)
LIMIT 20;
```

Expect far fewer shared buffers read and a shorter execution time. The application's knowledge search latency metrics are the final check.

## Re-enabling organization indexed search later

1. Restore Tin (`restore-tin-projection.ts --execute`) if keyword ranking over the index should use it.
2. Resume the connectors from the product. Their cursors were reset, so they list and index the whole source again. This costs about as much as the original indexing (provider API quota, embedding spend, and the index growth this runbook reversed).
3. Once the resync has written the chunks, backfill Tin (`--backfill`, or rebuild the index as described above).

## Local testing

The unit tests (`*.test.ts` here) mock the database and run with the normal suite. `dormant-org-search.integration.ts` runs the real scripts against a disposable local PostgreSQL database. It is not part of CI; run it by hand:

```sh
createdb sim_acl_test_dormant_ops
psql -d sim_acl_test_dormant_ops -c 'CREATE EXTENSION vector; CREATE EXTENSION btree_gin; CREATE EXTENSION pg_trgm;'
(cd packages/db && DATABASE_URL=postgresql://localhost:5432/sim_acl_test_dormant_ops bun run ./scripts/migrate.ts)
cd apps/sim && KNOWLEDGE_ACL_TEST_DATABASE_URL=postgresql://localhost:5432/sim_acl_test_dormant_ops \
  bunx vitest run --mode integration scripts/dormant-org-search/dormant-org-search.integration.ts
```

The test installs `0019`'s Tin functions and triggers where they are missing (the `tin` extension is not needed for them), and removes them again afterwards.
