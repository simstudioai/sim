import { knowledgeBase } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { isIndexedOrgSearchEnabled } from '@/lib/sim-search/indexed/gate'

/** Federated Search keeps source configuration but does not crawl content into a knowledge base. */
export function requiresConnectorIndexing(isSearchIndex?: boolean | null): boolean {
  return isIndexedOrgSearchEnabled() || isSearchIndex !== true
}

/** Keeps federated sources out of bounded indexing scheduler pages. */
export function connectorIndexingCondition() {
  return isIndexedOrgSearchEnabled() ? undefined : eq(knowledgeBase.isSearchIndex, false)
}
