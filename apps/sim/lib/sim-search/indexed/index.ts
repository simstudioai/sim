/**
 * Dormant indexed organization search: the use cases that search and read `is_search_index`
 * knowledge bases, and the indexed arms of the personal Search integration inventory. Callers
 * check `isIndexedOrgSearchEnabled()` before reaching these, and each refuses on its own while the
 * gate is off; see this directory's README.
 */

export { readIndexedKnowledgeDocument } from '@/lib/sim-search/indexed/documents/read-indexed-document'
export { readSearchDocument } from '@/lib/sim-search/indexed/documents/read-search-document'
export { ownsIndexedPersonalSearchAccount } from '@/lib/sim-search/indexed/integrations/personal-account-ownership'
export { loadIndexedSearchIntegrationInventory } from '@/lib/sim-search/indexed/integrations/personal-inventory'
export { listIndexedPersonalSearchIntegrations } from '@/lib/sim-search/indexed/integrations/personal-search-integrations'
export { registerIndexedKnowledgeMcpTools } from '@/lib/sim-search/indexed/mcp/register-tools'
export {
  searchOrganizationKnowledge,
  searchScopedKnowledge,
  searchWorkspaceKnowledge,
} from '@/lib/sim-search/indexed/search/scoped-search'
