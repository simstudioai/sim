/**
 * The search-index retrieval legs shared retrieval (`lib/knowledge/search/queries.ts`) runs for a
 * user-scoped search over search indexes while indexed organization search is on. Everything that
 * decides readability on the projection row lives behind this barrel: the resolved access plan
 * and the projection-row predicates built from it, reach and permitted sets, per-source vector
 * walks, the projection-fill probe, live source proof, and keyword ranking over the GIN and Tin
 * projections. Kept apart from the use-case barrel because the use cases depend on that retrieval
 * layer, which depends on these.
 */
export { prepareIndexedRetrieval } from '@/lib/sim-search/indexed/retrieval/legs'
