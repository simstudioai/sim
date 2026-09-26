# Indexed organization search (dormant)

The indexed backend for Sim Search: retrieval over `is_search_index` knowledge bases that organization and workspace connectors crawl into, ranked from the embedding projections. Live Search (`../live/`) replaced it. **This code is dormant**: it stays in the tree so it can be switched back on, but no request reaches it in a default deployment.

Ordinary workspace knowledge bases, the Knowledge block, the embedding projections, the projector, and the document access predicate (`lib/knowledge/access/predicate.ts`) live outside this directory and behave the same whichever backend is selected.

## The gate

`isIndexedOrgSearchEnabled()` in `gate.ts` is the only switch. It is the inverse of `SIM_SEARCH_LIVE`, which defaults to `true`, so indexed search is on only where a deployment sets `SIM_SEARCH_LIVE=false`. Every use case in this directory calls `assertIndexedOrgSearchEnabled()` itself, so dormancy holds even for a caller that skipped the gate.

While the gate is off:

- Search, the MCP tools, and Sim's `search_workspace` and `read_document` tools serve Live Search, and personal Search integrations are read from live accounts.
- Indexed-only surfaces refuse with `SearchIndexDormantError` (a `409`): the Stats report and connecting a source that crawls into a search index. The indexed document page is not found.
- A knowledge search that names a search-index knowledge base (the Knowledge block, v1, v2, Sim's knowledge tool) still answers from the documents it already holds, decided on each document exactly as a workspace knowledge base is.
- Nothing crawls into search indexes: content syncs, member syncs, and processing recovery skip them (`lib/knowledge/connectors/indexing-policy.ts`).
- The projector owes search-index documents nothing: their marks are released with the rest, and it writes no Tin keyword rows.

## Layout

- `gate.ts`: the switch, `SearchIndexDormantError`, and the search-index helpers. Anything may import it.
- `index.ts`: the use-case barrel. Its callers branch on the gate first.
- `search/`, `documents/`, `mcp/`, `integrations/`: indexed search, document reads, the indexed MCP tools, and the indexed arms of the personal Search integration inventory.
- `retrieval/`: the search-index retrieval legs behind one entry, `prepareIndexedRetrieval`, which `lib/knowledge/search/queries.ts` loads with a dynamic import only for a signed-in reader whose every base is a search index while the gate is on. Every other search, including every workspace knowledge base search, decides readability on the document and reads none of it.

The dormant UI sits in `indexed/` folders next to the component that picks it from `features.liveEnterpriseSearch` (`useDeploymentShape()`), so each can be deleted in one step: `app/o/[organizationId]/integrations/indexed/`, `app/o/[organizationId]/settings/components/integrations/indexed/`, and `app/workspace/[workspaceId]/home/components/knowledge-search-results/indexed/`.

## Re-enabling

1. Set `SIM_SEARCH_LIVE=false` in both the app and the Trigger.dev environment, and deploy. The container entrypoint (`apps/sim/bootstrap.ts`) mirrors it to `NEXT_PUBLIC_SIM_SEARCH_LIVE` for the client; crawling, processing, and projection read it in whichever process runs them.
2. Confirm the Tin objects exist (`0019_tin_keyword_projection`, `0024_knowledge_projection_async`), backfill `embedding_keyword_tin` for every search-index knowledge base, and build its index.
3. Resume and fully resync the connectors of search-index knowledge bases, so content that went stale while dormant is indexed again.

Projection rows written before projections carried their document's source and ACL are decided on their document until they are rewritten.

## Database objects it depends on

`knowledge_base.is_search_index`, `document.acl`, `document.connector_id`, `knowledge_connector`, `embedding_search`, `embedding_keyword_search`, `embedding_keyword_tin`, `knowledge_projection_dirty`, and the Tin extension objects. All of them are owned by `packages/db`; no schema or migration belongs to this directory.
