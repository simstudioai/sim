# Retiring one legacy Search index

`0027_retire_search_embeddings` runs through the existing script-migration registry without
cleanup flags. On its first invocation it discovers the sole knowledge base whose persisted
`is_search_index` marker is true and saves that target. No Search KB is a completed no-op;
multiple Search KBs fail without changing content because the target is ambiguous. Once saved,
the target stays fixed even if another Search KB is created. Ordinary KBs and the target's live
source/credential configuration, document metadata, and backing files are preserved.

## Deployment and execution

The app and workers must already use live Search, and older indexing jobs must be drained before
this cleanup ships: deployment migrations run before the new app switches over. `SIM_SEARCH_LIVE=true`
(the default) makes `isIndexedOrgSearchEnabled()` false. **`SIM_SEARCH_LIVE=false` enables indexed
Search again.** The cleanup does not inspect this flag. Live source setup may still create a Search
KB for configuration; it does not index content. Document uploads, dispatch and queued processing
also honor the indexed-search gate.

The ordinary migration runner starts the cleanup automatically and continues until it is complete
in the same deployment. There is no page-count or one-minute deferral. A successful run records
`0027_retire_search_embeddings` in `script_migrations` only after the target has no remaining chunks
or unretired documents. Previously deferred runs resume their existing saved target, phase and cursor.
The next registered migration, `0028_maintain_search_retirement`, rebuilds the HNSW indexes and vacuums
the affected tables before deployment continues. Its separate receipt also makes maintenance run
where the original retirement was already completed before this upgrade.

Pages contain at most 25,000 IDs and execute sequentially without a pacing delay. Materialized SQL
pages keep the IDs inside PostgreSQL; the migration process receives only a cursor and a validation
result. Each page uses a two-minute statement timeout and a one-second lock timeout. Brief lock
timeouts retry the rolled-back page with bounded backoff for up to one minute. Other errors, or
exhausted lock retries, fail the migration without a completion receipt. Progress is logged every
ten pages. The deployment job retains its five-hour overall timeout; it is not a runtime estimate.

After interruption or failure, rerun the migration job, or run
`bun run packages/db/script-migrations/0027_retire_search_embeddings.ts` with the writer supplied
through the normal `MIGRATION_DATABASE_URL`/`DATABASE_URL` configuration. Completed pages remain
committed and the failed page is retried from its saved cursor. The standalone command runs both
retirement and maintenance through the same journal. Keep one maintenance worker and monitor primary
latency, WAL, replica lag and available disk.

The runner-owned `search_embedding_cleanup_progress` table stores the selected KB, phase and ID
cursor. Page mutations and cursor advancement commit together. The one-off migration journal
records only completion. `db:push` excludes the progress table from schema diffing.

The documents phase fences queued and in-flight processing by marking only target documents
excluded/disabled and clearing their dispatch stamps. The embeddings phase deletes only target
chunks, and refuses a page whose target document was not retired or has inconsistent ownership.
The existing foreign keys cascade to vector/keyword projections and chunk provenance. Both phases
walk the primary key in bounded pages; unrelated rows are read only as IDs and are never updated.
This avoids sorting a whole KB or repeatedly scanning earlier pages when no suitable composite
cleanup index exists. Resumption continues the saved scan, including across pages containing only
unrelated rows. Before completion, the cleanup checks for unretired documents and remaining chunks
behind either cursor and restarts the affected phase if needed. Keep target writers stopped and
do not change its marker during the pass.

Inspect progress with:

```sql
SELECT * FROM search_embedding_cleanup_progress;
SELECT name, applied_at FROM script_migrations
WHERE name IN ('0027_retire_search_embeddings', '0028_maintain_search_retirement');
```

After completion, check the selected KB has no `embedding` rows, verify its live Search, and verify
ordinary KB retrieval. A zero-row absence check may still scan index entries; use an appropriate
timeout. The cleanup is destructive and not reversible by flipping the search flag. Re-enabling
indexed Search requires deliberately restoring document eligibility and fully resyncing its sources.

## Storage maintenance

After deletion, `0028` runs `REINDEX INDEX CONCURRENTLY` on each HNSW index of `embedding_search`,
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
