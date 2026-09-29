# Retiring one legacy Search index

`0027_retire_search_embeddings` runs through the existing script-migration registry without
cleanup flags. On its first invocation it discovers the sole knowledge base whose persisted
`is_search_index` marker is true and saves that target. No Search KB is a completed no-op;
multiple Search KBs defer without changing content because the target is ambiguous. Once saved,
the target stays fixed even if another Search KB is created. Ordinary KBs and the target's live
source/credential configuration, document metadata, and backing files are preserved.

## Deployment and execution

The app and workers must already use live Search, and older indexing jobs must be drained before
this cleanup ships: deployment migrations run before the new app switches over. `SIM_SEARCH_LIVE=true`
(the default) makes `isIndexedOrgSearchEnabled()` false. **`SIM_SEARCH_LIVE=false` enables indexed
Search again.** The cleanup does not inspect this flag. Live source setup may still create a Search
KB for configuration; it does not index content. Document uploads, dispatch and queued processing
also honor the indexed-search gate.

The ordinary migration runner starts the cleanup automatically. For subsequent maintenance passes,
run `bun run packages/db/script-migrations/0027_retire_search_embeddings.ts` with the writer supplied
through the normal `MIGRATION_DATABASE_URL`/`DATABASE_URL` configuration. Repeat until
`script_migrations` records `0027_retire_search_embeddings`. A budget deferral exits normally without
recording completion; it is **not** a completed purge.

Each invocation handles at most 100 pages of 500 IDs, with a 60-second budget between pages,
a 15-second statement timeout, a one-second lock timeout and 100 ms pacing. One in-flight statement
can finish after the run budget. Keep one maintenance worker and monitor primary latency, WAL,
replica lag and available disk. Lock/query failures stop the invocation; rerun after resolving them.

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
SELECT knowledge_base_id, phase, after_id FROM search_embedding_cleanup_progress;
SELECT name, applied_at FROM script_migrations WHERE name = '0027_retire_search_embeddings';
```

After completion, check the selected KB has no `embedding` rows, verify its live Search, and verify
ordinary KB retrieval. A zero-row absence check may still scan index entries; use an appropriate
timeout. The cleanup is destructive and not reversible by flipping the search flag. Re-enabling
indexed Search requires deliberately restoring document eligibility and fully resyncing its sources.

## Storage maintenance

No vacuum, reindex or table rewrite runs inside this backfill. Plan maintenance separately on the
writer, outside transactions. Ordinary `VACUUM (ANALYZE, TRUNCATE FALSE)` on affected source,
projection and document tables makes dead space reusable and refreshes planner statistics. It
generally does not shrink allocated files. `VACUUM FULL` takes an exclusive lock and requires extra
space; use a separately planned maintenance window or a provider-supported online rewrite for
physical shrinkage. HNSW may benefit from `REINDEX INDEX CONCURRENTLY` before vacuum, with enough
temporary disk and WAL capacity. See the [PostgreSQL vacuum documentation](https://www.postgresql.org/docs/17/sql-vacuum.html)
and [pgvector maintenance guidance](https://github.com/pgvector/pgvector#vacuuming).

Document counts are historical until a later document cleanup. Do not raw-delete documents or
bucket objects: their application hard-delete path also enqueues identity-bound storage cleanup
and applies accounting. Its ordinary scoped mode excludes retired documents, so a follow-up must
explicitly support these rows while preserving those side effects. Do not delete source accounts,
integration policies or permission grants used by live Search.
