import { isLiveEnterpriseSearchEnabled } from '@/lib/core/config/env-flags'

/** What a caller is told when it names a search index while indexed organization search is off. */
export const SEARCH_INDEX_DORMANT_MESSAGE = 'This search index is inactive; use Sim Search.'

/**
 * The single switch for indexed organization search: retrieval over `is_search_index` knowledge
 * bases and the crawling that fills them. It is the inverse of the Live Search backend selector
 * (`SIM_SEARCH_LIVE`, on by default), so indexed search is dormant unless a deployment sets
 * `SIM_SEARCH_LIVE=false`. Read on every call rather than captured, so a caller always observes
 * the current selector.
 */
export function isIndexedOrgSearchEnabled(): boolean {
  return !isLiveEnterpriseSearchEnabled
}

/** A search named a search-index knowledge base while indexed organization search is dormant. */
export class SearchIndexDormantError extends Error {
  constructor() {
    super(SEARCH_INDEX_DORMANT_MESSAGE)
    this.name = 'SearchIndexDormantError'
  }
}

/**
 * Refuses a search over any search-index knowledge base while indexed organization search is
 * dormant. Its rows are neither crawled nor projected in that state, so answering from them would
 * return stale content under current permissions. Workspace knowledge bases are never refused.
 */
export function assertSearchIndexesActive(
  knowledgeBases: ReadonlyArray<{ isSearchIndex?: boolean | null }>
): void {
  if (isIndexedOrgSearchEnabled()) return
  if (knowledgeBases.some((knowledgeBase) => knowledgeBase.isSearchIndex === true))
    throw new SearchIndexDormantError()
}
