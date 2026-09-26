import { isLiveEnterpriseSearchEnabled } from '@/lib/core/config/env-flags'

/**
 * The single switch for indexed organization search: retrieval over `is_search_index` knowledge
 * bases and the crawling that fills them. It is the inverse of the Live Search backend selector
 * (`SIM_SEARCH_LIVE`, on by default), so indexed search is dormant unless a deployment sets
 * `SIM_SEARCH_LIVE=false`. The selector is read once at startup, so the answer is constant for the
 * life of the process.
 */
export function isIndexedOrgSearchEnabled(): boolean {
  return !isLiveEnterpriseSearchEnabled
}

/** An indexed-only surface was reached while indexed organization search is dormant. */
export class SearchIndexDormantError extends Error {
  constructor() {
    super('This search index is inactive; use Sim Search.')
    this.name = 'SearchIndexDormantError'
  }
}

/**
 * Refuses entry to dormant indexed organization search. Every indexed use case and entry calls it
 * itself, so dormancy holds even for a caller that forgot to ask the gate.
 */
export function assertIndexedOrgSearchEnabled(): void {
  if (!isIndexedOrgSearchEnabled()) throw new SearchIndexDormantError()
}

/**
 * Whether a search runs the search-index retrieval legs: indexed organization search is on and
 * every knowledge base it names is a search index. Every other search decides readability on
 * each candidate's document.
 */
export function usesIndexedRetrieval(
  knowledgeBases: ReadonlyArray<{ isSearchIndex?: boolean | null }>
): boolean {
  return (
    isIndexedOrgSearchEnabled() &&
    knowledgeBases.every((knowledgeBase) => knowledgeBase.isSearchIndex === true)
  )
}
