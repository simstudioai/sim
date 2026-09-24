# Indexed organization search (dormant)

This directory holds the indexed backend for Sim Search: retrieval over `is_search_index` knowledge bases that organization and workspace connectors crawl into, ranked from the embedding projections, with Tin keyword ranking where the database provides it. Live Search (`../live/`) replaced it. **This code is dormant.** It stays in the tree so it can be switched back on, but no request reaches it in a default deployment.

Ordinary workspace knowledge bases, the Knowledge block, the embedding projections, the projector, connector member and ACL machinery, and source vector indexes are shared with other features. They live outside this directory and behave the same whichever backend is selected.

## The gate

One switch decides: `isIndexedOrgSearchEnabled()` in `gate.ts`. It is the inverse of the Live Search backend selector, `SIM_SEARCH_LIVE`, which defaults to `true`. Indexed search is on only when a deployment sets `SIM_SEARCH_LIVE=false`.

While the gate is off:

- The internal search route, the MCP search and read tools, and Sim's `search_workspace` and `read_document` tools serve Live Search.
- The indexed document page (`/o/[organizationId]/knowledge/[knowledgeBaseId]/[documentId]`) is not found.
- A search that names a search-index knowledge base by id (the Knowledge block, internal, v1 and v2 knowledge search) is refused with `SearchIndexDormantError`, a `409` reading "This search index is inactive; use Sim Search." Workspace knowledge bases are searched as before.
- Connector content syncs and member syncs skip search-index knowledge bases (`lib/knowledge/connectors/indexing-policy.ts`).
- The projector writes no `embedding_keyword_tin` rows, and its source and ACL fill (`knowledge-projection-fill`) passes over search-index rows. Every other projection of a marked document, search index or not, is still written, so workspace knowledge bases project as before.
- Shared retrieval (`lib/knowledge/search/queries.ts`) does not run the search-index-only strategies below.

## Layout

- `gate.ts` is the switch, the dormant error, and `assertSearchIndexesActive`. Anything may import it.
- `index.ts` is the use-case barrel: `searchScopedKnowledge`, `searchOrganizationKnowledge`, `searchWorkspaceKnowledge`, `readSearchDocument`, and `readIndexedKnowledgeDocument`.
- `search/scoped-search.ts` resolves an owner's search index and runs the shared knowledge search over it.
- `documents/` reads indexed passages for Sim's `read_document` tool, the document page, and the MCP `read_document` tool.
- `retrieval/` is the barrel for the search-index-only retrieval strategies that shared retrieval calls: Tin keyword ranking (`tin-keyword.ts`, `tin-query.ts`, flag `knowledge-tin-keyword`) and the projection-fill probe (`projection-fill.ts`). It is separate from `index.ts` because the use cases depend on shared retrieval, which depends on these.

`scripts/check-indexed-org-search-boundary.ts` (`bun run check:indexed-org-search-boundary`, part of `check:audits`) enforces the edge. Outside this directory, only the entry files it allowlists import a barrel, each of them must import the gate, and no file imports past a barrel. Tests are exempt.

## The projection-fill probe

Search-index retrieval asks whether a projection still has rows the source and ACL fill has not reached. Filled rows are decided on the row alone and permit a wider vector walk. The probe reads the last unfilled row from the partial index over rows with a null `acl`. It spends at most 250 ms of the leg's budget, and a filled answer is remembered for 60 seconds. An unknown answer, whether from a failure or an exhausted cap, counts as unfilled and is remembered for 5 seconds. A probe cancelled by its own search is not remembered.

## Re-enabling

1. Confirm the Tin objects still exist, and restore them where they were removed: the `tin` extension, `knowledge_tin_stream`, `knowledge_tin_base_token`, and `knowledge_tin_membership_key`, the `embedding_keyword_tin_sync` and `knowledge_base_keyword_tin_sync` triggers, and a valid `embedding_keyword_tin_content_idx`. Script migrations `0019_tin_keyword_projection` and `0024_knowledge_projection_async` install them.
2. Backfill `embedding_keyword_tin` for every search-index knowledge base, then build the Tin index.
3. Set `SIM_SEARCH_LIVE=false` and deploy. The container entrypoint (`apps/sim/bootstrap.ts`) mirrors it to `NEXT_PUBLIC_SIM_SEARCH_LIVE` for the client.
4. Re-enable and resync organization connectors on search-index knowledge bases. Content and member syncs resume on their own once the gate is on. Paused sources need to be resumed, and a full resync refreshes content that went stale while the gate was off.
5. Turn on `knowledge-projection-fill` so the fill reaches search-index rows again, and `knowledge-tin-keyword` once the Tin index is valid.
6. Optionally run `apps/sim/scripts/prewarm-search-projection.ts` after the backfill.

## Database objects it depends on

- `knowledge_base.is_search_index`, `document.acl`, `document.connector_id`, and `knowledge_connector`.
- `embedding` and the projections: `embedding_search` (vectors plus mirrored `connector_id` and `acl`), `embedding_keyword_search` (GIN keyword ranking), and `embedding_keyword_tin` (Tin keyword ranking, search-index rows only).
- The partial indexes over unfilled projection rows (`acl IS NULL`) that the fill and the probe read.
- `knowledge_projection_dirty` and the projector triggers that mark it.
- The Tin extension objects listed under re-enabling.

No schema or migration belongs to this directory. Every object above is shared or owned by `packages/db`.
