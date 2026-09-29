# Retiring one legacy Search index

`0027_retire_search_embeddings` is an opt-in entry in the existing script-migration registry.
It retires the documents and deletes the embeddings of **one explicitly selected** knowledge base
whose persisted `is_search_index` marker is true. It preserves other Search indexes, ordinary KBs,
the selected KB's source/credential configuration, document metadata, and backing files.

## Deployment and execution

1. Deploy the current live-search indexing guards to every app, scheduler and Trigger worker.
   Drain/cancel jobs on older deployments. Do not enable this cleanup during that first rollout:
   migrations run before the app switches over. Stop direct/manual writes to the selected KB too.
2. Confirm the app and workers use live Search. `SIM_SEARCH_LIVE=true` (the default) makes
   `isIndexedOrgSearchEnabled()` false. **`SIM_SEARCH_LIVE=false` enables indexed Search again.**
   Live source setup may still create a Search KB to store source configuration; it is not content
   indexing. Document dispatch and old queued document workers also honor the indexed-search gate.
3. Verify the selected KB's ownership and marker on the writer, and confirm backup/recovery coverage.
4. On a separate maintenance run, set `SIM_SEARCH_LIVE=true`,
   `SIM_SEARCH_PURGE_LEGACY_EMBEDDINGS=true`, and
   `SIM_SEARCH_CLEANUP_KNOWLEDGE_BASE_ID=<reviewed-search-kb-id>`. These are an operator attestation
   that the deployment and writer prerequisites hold, not a remote inspection of worker settings.
5. Run `bun run packages/db/script-migrations/0027_retire_search_embeddings.ts` with the writer
   supplied through the normal `MIGRATION_DATABASE_URL`/`DATABASE_URL` configuration. The standalone
   entry uses the existing migration journal. The ordinary migration runner can run it too.
6. Repeat until `script_migrations` records `0027_retire_search_embeddings`. A budget deferral exits
   normally without recording completion; it is **not** a completed purge. Remove the opt-in when done.

Each invocation handles at most 100 pages by default, at most 500 IDs per page, with a 60-second
budget between pages, a 15-second statement timeout, a one-second lock timeout and 100 ms pacing.
`SIM_SEARCH_CLEANUP_MAX_BATCHES` accepts 1–1000 to tune the per-run cap. One in-flight statement
can finish after the run budget. Keep one maintenance worker and monitor primary latency, WAL,
replica lag and available disk. Lock/query failures stop the invocation; rerun after resolving them.

The runner-owned `search_embedding_cleanup_progress` table stores the selected KB, phase and ID
cursor. Page mutations and cursor advancement commit together. Changing the selected KB on resume
is rejected. The one-off migration journal records only completion, so this entry is intentionally
not a bulk purge command for arbitrary KBs. `db:push` excludes this progress table from schema diffing.

The documents phase fences queued and in-flight processing by marking only target documents
excluded/disabled and clearing their dispatch stamps. The embeddings phase deletes only target
chunks, and refuses a page whose target document was not retired or has inconsistent ownership.
The existing foreign keys cascade to vector/keyword projections and chunk provenance. Both phases
walk the primary key in bounded pages; unrelated rows are read only as IDs and are never updated.
This avoids sorting a whole KB or repeatedly scanning earlier pages when no suitable composite
cleanup index exists. Resumption continues the saved scan, including across pages containing only
unrelated rows. Do not create new target documents, chunks, or change its marker during the pass.

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
