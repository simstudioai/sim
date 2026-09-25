import { knowledgeBase } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { isLiveEnterpriseSearchEnabled } from '@/lib/core/config/env-flags'

/** Federated Search keeps source configuration but does not crawl content into a knowledge base. */
export function requiresConnectorIndexing(isSearchIndex?: boolean | null): boolean {
  return !isLiveEnterpriseSearchEnabled || isSearchIndex !== true
}

/** Keeps federated sources out of bounded indexing scheduler pages. */
export function connectorIndexingCondition() {
  return isLiveEnterpriseSearchEnabled ? eq(knowledgeBase.isSearchIndex, false) : undefined
}
