import { knowledgeBase } from '@sim/db/schema'
import { eq } from 'drizzle-orm'

/** Federated Search keeps source configuration but does not crawl content into a knowledge base. */
export function requiresConnectorIndexing(isSearchIndex?: boolean | null): boolean {
  return isSearchIndex !== true
}

/** Keeps federated sources out of bounded indexing scheduler pages. */
export function connectorIndexingCondition() {
  return eq(knowledgeBase.isSearchIndex, false)
}
