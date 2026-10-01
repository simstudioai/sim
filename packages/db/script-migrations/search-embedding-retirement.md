# Retiring legacy Search indexes

The old `0027` CLI is disabled. Its `--maintenance` path performed large concurrent HNSW rebuilds
without workload-health gates. The historical implementations and receipts remain for compatibility;
none of `0027`–`0029` is registered in deployment migrations.

Use the [operator-run replacement workflow](../maintenance/search-retirement.md). It builds empty
HNSW indexes first, copies ordinary-KB vectors in bounded pages, validates and cuts over separately,
then slowly removes Search chunks. It never invokes `0028` or `REINDEX`/`VACUUM FULL`.

Existing `search_embedding_cleanup_progress`, `search_embedding_cleanup_targets`, and migration
receipts are retained. Already-deleted chunks need no further work. The replacement reconstructs
ordinary vectors from canonical embeddings, including deferred projections. It captures the current
Search-marked KB set anew and rechecks markers before mutation; live KB/source configuration survives.

Do not run older cleanup binaries alongside the replacement. Stop old workers and maintenance jobs
before preparing it. Its guard also prevents an existing legacy cursor from advancing while the
replacement exists.
