# Retiring legacy Search indexes

`0029_retire_all_search_embeddings` runs through the existing script-migration registry without
cleanup flags. It supersedes the single-KB retirement and maintenance entries (`0027`/`0028`),
including databases that already recorded either receipt. It snapshots every knowledge base whose
persisted `is_search_index` marker is true. No Search KB is a completed no-op. Once saved, the
snapshot stays fixed across retries even if another Search KB is created. Ordinary KBs and the
selected KBs' live source/credential configuration, document metadata, and backing files are preserved.

## Deployment and execution

The app and workers must already use live Search, and older indexing jobs must be drained before
this cleanup ships: deployment migrations run before the new app switches over. `SIM_SEARCH_LIVE=true`
(the default) makes `isIndexedOrgSearchEnabled()` false. **`SIM_SEARCH_LIVE=false` enables indexed
Search again.** The cleanup does not inspect this flag. Live source setup may still create a Search
KB for configuration; it does not index content. Document uploads, dispatch and queued processing
also honor the indexed-search gate.

The ordinary migration runner starts the cleanup automatically and continues until it is complete
in the same deployment. There is no page-count or one-minute deferral. A successful run records
`0029_retire_all_search_embeddings` and its superseded names in `script_migrations` only after all
selected KBs have no remaining chunks or unretired documents and index maintenance finishes.
On upgrading a legacy single-KB checkpoint, the snapshot and cursor reset commit atomically. The
scan starts at the beginning once so it includes other KBs behind the old cursor; previous deletes
remain committed. Maintenance checkpoints also reset once because the expanded cleanup creates new
dead entries. A completed legacy checkpoint does not require its former KB to still exist or remain
Search-marked; the new snapshot selects current Search KBs and preserves any KB now marked ordinary.
An unfinished legacy checkpoint still requires its target to remain Search-marked. Subsequent retries
resume the saved scope, phase, cursor and maintenance checkpoints.
The existing maintenance implementation rebuilds HNSW indexes and vacuums affected tables before
deployment continues.

Each page reads at most 25,000 IDs and mutates at most a row limit of them, and pages execute
sequentially without a pacing delay. Retiring a document is a non-HOT update that writes every
index on `document`, and deleting a chunk cascades into its projections, so a page's cost follows
the target rows it mutates, not the IDs it reads. A page that reaches the row limit advances the
cursor only to its last mutated row; the rest of its scan is read again by the next page. Documents
that are already retired never count against the limit. The limit starts at 2,000 rows, halves after
a page slower than 30 seconds, and doubles (up to 25,000) after a fast page that reached it.
Materialized SQL pages keep the IDs inside PostgreSQL; the migration process receives only a cursor
and a validation result. Each page uses a two-minute statement timeout and a one-second lock timeout.
A page that exceeds the statement timeout rolls back with its cursor and is retried with half the
row limit; one that still times out at 25 rows fails the migration. The completion rechecks, which
walk every captured KB once, run with a 30-minute timeout. Brief lock timeouts retry the rolled-back
page with bounded backoff for up to one minute. Other errors, or exhausted lock retries, fail the
migration without a completion receipt. Progress is logged every
ten pages. The deployment job retains its five-hour overall timeout; it is not a runtime estimate.

After interruption or failure, rerun the migration job, or run
`bun run packages/db/script-migrations/0027_retire_search_embeddings.ts` with the writer supplied
through the normal `MIGRATION_DATABASE_URL`/`DATABASE_URL` configuration. Completed pages remain
committed and the failed page is retried from its saved cursor. The standalone command runs both
retirement and maintenance through the successor migration and the same journal. Keep one maintenance worker and monitor primary
latency, WAL, replica lag and available disk.

Both entry points require a direct or session-pooled PostgreSQL connection, as the deployment
migration runner already does for its session advisory lock and settings. `DATABASE_URL` is a valid
fallback only when it provides that session affinity. PgBouncer transaction pooling is unsupported;
reserving a postgres.js client connection does not pin a backend through a transaction pooler.

The runner-owned `search_embedding_cleanup_targets` table stores the frozen KB set, populated in
bounded SQL pages within one repeatable-read transaction. The existing `search_embedding_cleanup_progress`
row stores the shared phase and ID cursor; its legacy `knowledge_base_id` remains an informational
anchor, not the full deletion scope. Page mutations and cursor advancement commit together.
The one-off migration journal records only completion. `db:push` excludes both bookkeeping tables
from schema diffing.

The documents phase fences queued and in-flight processing by marking only target documents
excluded/disabled and clearing their dispatch stamps. The embeddings phase deletes only target
chunks, and refuses a page whose target document was not retired or has inconsistent ownership.
The existing foreign keys cascade to vector/keyword projections and chunk provenance. Both phases
walk the primary key once for the entire captured set in bounded pages; ordinary rows are never
updated. Each page locks and rechecks the Search markers for its target KBs before mutation, and
fails atomically if any target changed to an ordinary KB. This avoids a separate full-table scan
per KB or sorting a whole KB when no suitable composite cleanup index exists. Resumption continues the saved scan, including across pages containing only
unrelated rows. Before completion, the cleanup checks for unretired documents and remaining chunks
behind either cursor and restarts the affected phase if needed. A final bounded pass validates all
captured KB markers, including empty KBs and KBs whose rows were already scanned, holding shared
marker locks until the completion checkpoint commits. Resuming a completed cleanup before maintenance
also revalidates the captured set. Keep target writers stopped and
do not change their Search markers during the pass.

Inspect progress with:

```sql
SELECT * FROM search_embedding_cleanup_progress;
SELECT name, applied_at FROM script_migrations
WHERE name IN ('0027_retire_search_embeddings', '0028_maintain_search_retirement',
               '0029_retire_all_search_embeddings');
```

After completion, check the selected KBs have no `embedding` rows, verify their live Search, and verify
ordinary KB retrieval. A zero-row absence check may still scan index entries; use an appropriate
timeout. The cleanup is destructive and not reversible by flipping the search flag. Re-enabling
indexed Search requires deliberately restoring document eligibility and fully resyncing its sources.

## Storage maintenance

After deletion, `0029` invokes the existing maintenance implementation to run `REINDEX INDEX CONCURRENTLY` on each HNSW index of `embedding_search`,
then `VACUUM (ANALYZE, TRUNCATE FALSE)` on the vector and keyword projections, chunk provenance,
embeddings, and documents. These operations execute sequentially outside transactions. Rebuilds
keep ordinary reads and writes available and require temporary index space and WAL capacity.
They wait for older transactions and can dominate total runtime; the five-hour job deadline still
applies. PostgreSQL's `pg_stat_progress_create_index` and `pg_stat_progress_vacuum` expose progress.

The existing progress row gains `reindexed_through` and `vacuumed_tables` checkpoints. Completed
indexes and tables are skipped on retry; interruption between an operation and its checkpoint may
repeat that one operation. Invalid `_ccnew`/`_ccold` siblings from an interrupted concurrent rebuild
are removed concurrently before retrying their original index. One advisory lock serializes the
maintenance worker. Do not run other index maintenance on these tables at the same time.

Ordinary vacuum makes dead space reusable and refreshes planner statistics; it generally does not
shrink table files. This migration does not run `VACUUM FULL` or rewrite tables. See the
[PostgreSQL vacuum documentation](https://www.postgresql.org/docs/17/sql-vacuum.html),
[concurrent reindex recovery](https://www.postgresql.org/docs/17/sql-reindex.html#SQL-REINDEX-CONCURRENTLY),
and [pgvector maintenance guidance](https://github.com/pgvector/pgvector#vacuuming).

Document counts are historical until a later document cleanup. Do not raw-delete documents or
bucket objects: their application hard-delete path also enqueues identity-bound storage cleanup
and applies accounting. Its ordinary scoped mode excludes retired documents, so a follow-up must
explicitly support these rows while preserving those side effects. Do not delete source accounts,
integration policies or permission grants used by live Search.
