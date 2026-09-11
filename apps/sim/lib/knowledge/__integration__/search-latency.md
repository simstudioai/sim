# Assistant search performance harness

Run from the repository root with Docker running:

```sh
KNOWLEDGE_SEARCH_PERFORMANCE_REPORT_FILE=/tmp/search-performance.json bun run test:search-performance
```

The existing integration runner creates disposable PostgreSQL/pgvector and Redis containers, installs the current schema, and removes the containers afterwards by default. It does not use an application database or inherit application credentials. The suite is opt-in; ordinary unit tests do not load the corpus.

The default corpus contains 20,000 chunks in the searched index and 10,000 in an unrelated workspace, four chunks per document, approximately 3 KB of text per chunk, and dense 1,536-dimensional normalized vectors distributed across 32 topics. Seeding temporarily removes HNSW indexes for bulk loading and restores their exact schema definitions before `ANALYZE` and measurement. No query-planner switches force index usage.

For a larger run, set `KNOWLEDGE_SEARCH_PERFORMANCE_CHUNKS=100000`. This setting controls the searched index; the unrelated index adds another 50%. It accepts multiples of 1,000 between 10,000 and 200,000. Corpus construction dominates runtime; large configurations can take tens of minutes, with a one-hour setup limit.

The harness calls the actual `search_workspace` Assistant tool, including its delegation, application use cases, embedding client, hybrid search, live access provider, PostgreSQL predicates, provenance processing, document metadata, and citation presentation. It exercises:

- First and repeated broad searches, with another workspace's matching content present.
- An identical Search-tab session request and Assistant request, comparing their real retrieval SQL.
- A user with no matching document permissions.
- A small permission scope ranked only over its bounded candidate IDs.
- A small selected document set containing an excluded document.
- Two simultaneous tool calls with different queries.
- Managed Confluence reader credentials, successful live verification, revocation, and restored access.
- An organization index accessed through a persisted private Mothership chat.

The JSON report records total tool latency, the actual diagnostic stage summaries, SQL count, returned passage count, server version, captured SQL with its synthetic parameters, and `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. Explain replay uses the application's transaction-local HNSW settings and runs outside the reported tool time. This avoids benchmarking a hand-written approximation of the search query. Broad-search plans are also regression assertions, rather than relying on noisy wall-clock thresholds.

For direct follow-up SQL measurements, set `KNOWLEDGE_SEARCH_PERFORMANCE_KEEP_DATABASE=true` together with the report path. The runner prints the disposable container and connection URL and preserves the fixture rows. Stop that container with `docker stop <printed-container>` when finished. Redis is always removed.

Reuse that corpus without rebuilding it by running the suite directly from `apps/sim`:

```sh
KNOWLEDGE_ACL_TEST_DATABASE_URL='<printed disposable URL>' \
KNOWLEDGE_SEARCH_PERFORMANCE_TEST=true \
KNOWLEDGE_SEARCH_PERFORMANCE_KEEP_DATABASE=true \
KNOWLEDGE_SEARCH_PERFORMANCE_REUSE_REPORT_FILE=/tmp/search-performance.json \
KNOWLEDGE_SEARCH_PERFORMANCE_REPORT_FILE=/tmp/search-after.json \
bunx vitest run --mode integration search-latency
```

Reuse verifies both fixture owners and chunk counts, then resets only the synthetic reader credentials, chat, index ownership, and document access state changed by this suite. Use the same chunk-count setting as the initial run. The report includes the bounded, vector-free visibility probe as well as ordered retrieval plans, so account for both when comparing vector SQL time.

The external embedding and Confluence permission responses are controlled HTTP-boundary fixtures; no internal search or authorization function is mocked. Vectors test retrieval mechanics, not semantic relevance. The integration environment disables hosted billing and does not exercise the remote agent stream, network latency, production hardware, a cold operating-system cache, or a production database's size and statistics. Report first and repeated samples separately; do not label them production latency or cold-cache benchmarks.

To compare a change, run the same harness, corpus size, and database image against both revisions on the same machine. Keep reports outside the checkout. Inspect vector-index usage, rows scanned, buffer reads, sort work, result counts, and live-access correctness alongside total latency. Avoid running other CPU-heavy checks during measurements.

## Production diagnostics

`KnowledgeSearchDiagnostics` emits one `Knowledge search completed` record for each search, on both `dashboard` and `copilot` surfaces. Each record has a unique `searchId`; Assistant records also carry the trusted `toolCallId` and, when available, `executionId`. The request logger attaches the HTTP request ID. Concurrent calls remain separate even when they share a request or agent turn. Searches lasting five seconds emit `Knowledge search still running` records with their active stages, including when a dependency has not returned.

The summary includes effective mode, vector dimensions, requested result count, canonical owner scope and effective access-scope kind, filter counts/presence, provenance presence, result count, outcome, and per-stage call count, total time, maximum time, and error count. It never records query text, filter values, document identifiers/content, vectors, SQL, credentials, or provider error bodies. Failed and cancelled calls still emit a summary; an error caught by a best-effort stage appears in that stage's error count even if the overall search succeeds.

Stages distinguish scope/index resolution, application execution (including authorization), billing attribution and admission, Assistant input projection, embedding, identity/access scope, search defaults, vector/keyword legs, candidate selection, live reader authorization, content hydration, result provenance, reranking, usage recording, overage billing, tag definitions, metadata authorization/SQL, metadata provenance, activity recording, and Assistant citation presentation. Vector candidates further distinguish the bounded probe, ANN query, and exact fallback. `vector.connection_acquire` includes pool acquisition and transaction start; SQL stage times include driver/network waits, not just database execution.

Stages nest and the vector/keyword and embedding/access/defaults stages run concurrently: **do not sum their totals**. Inspect the slowest leaf and its parent, and use active stages to locate an unfinished wait. Application time not covered by its child stages includes authorization and wrapper overhead. A large `tool_application` gap before the application stages points to delegation/setup. Compare the tool's completion with existing agent tool-dispatch/resume events using `toolCallId` to identify time outside this process; these diagnostics do not measure the remote agent's queue or subsequent model generation.

The harness runs an identical person/query/index/result-count search through the Search tab's session application entry point and through the Assistant tool, and verifies that both issue the same vector SQL. The Search tab does not supply a secret trace registry; Assistant additionally imports persisted result provenance and formats model citations. The Search tab also caches an identical scope/query/filter combination for 60 seconds in React Query; Assistant tool calls always execute a fresh server search. Cache hits produce no new server diagnostic record. The two surfaces otherwise share retrieval defaults and the canonical index, so an Assistant-only delay should not be attributed to SQL without these stage timings.
