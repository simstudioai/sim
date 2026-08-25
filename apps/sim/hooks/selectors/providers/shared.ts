import type { SelectorContext, SelectorKey } from '@/hooks/selectors/types'

export const SELECTOR_STALE = 60 * 1000

/**
 * The shorter stale window carried by `google.drive`, `jira.issues` and
 * `webflow.items`, whose listings turn over faster than {@link SELECTOR_STALE}
 * assumes.
 *
 * Not every search-backed selector uses it — several still sit on
 * {@link SELECTOR_STALE} — so treat this as the value those three share rather
 * than a rule about search.
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
