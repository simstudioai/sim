import type { SelectorContext, SelectorKey } from '@/hooks/selectors/types'

export const SELECTOR_STALE = 60 * 1000

/**
 * Stale window for selectors whose result set is search-backed.
 *
 * Shorter than {@link SELECTOR_STALE} because the query key carries the search
 * term, so a stale entry is a stale answer to a question the user is still
 * typing rather than a stale copy of a stable list.
 */
export const SELECTOR_SEARCH_STALE = 15 * 1000

export const ensureCredential = (context: SelectorContext, key: SelectorKey): string => {
  if (!context.oauthCredential) {
    throw new Error(`Missing credential for selector ${key}`)
  }
  return context.oauthCredential
}

export const ensureDomain = (context: SelectorContext, key: SelectorKey): string => {
  if (!context.domain) {
    throw new Error(`Missing domain for selector ${key}`)
  }
  return context.domain
}

export const ensureKnowledgeBase = (context: SelectorContext): string => {
  if (!context.knowledgeBaseId) {
    throw new Error('Missing knowledge base id')
  }
  return context.knowledgeBaseId
}
