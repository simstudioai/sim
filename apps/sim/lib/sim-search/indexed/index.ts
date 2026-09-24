/**
 * Dormant indexed organization search: the use cases that search and read `is_search_index`
 * knowledge bases. Every caller outside this directory is an allowlisted entry point that checks
 * `isIndexedOrgSearchEnabled()` from `@/lib/sim-search/indexed/gate` before it reaches these; see
 * `scripts/check-indexed-org-search-boundary.ts` and this directory's README.
 */
export { readIndexedKnowledgeDocument } from '@/lib/sim-search/indexed/documents/read-indexed-document'
export { readSearchDocument } from '@/lib/sim-search/indexed/documents/read-search-document'
export {
  searchOrganizationKnowledge,
  searchScopedKnowledge,
  searchWorkspaceKnowledge,
} from '@/lib/sim-search/indexed/search/scoped-search'
