import { useQuery } from '@tanstack/react-query'
import {
  loadBrowserSearchSuggestions,
  loadBrowserSuggestionSources,
} from '@/lib/browser-agent/transport'

/** Stale at once: the omnibox re-reads what the browser knows each time its panel comes back. */
const BROWSER_SUGGESTION_SOURCES_STALE_TIME = 0
/** One typed query's completions hold while the user edits around it. */
const BROWSER_SEARCH_SUGGESTIONS_STALE_TIME = 60 * 1000

const browserSuggestionKeys = {
  all: ['browser-suggestions'] as const,
  sources: () => [...browserSuggestionKeys.all, 'sources'] as const,
  searches: () => [...browserSuggestionKeys.all, 'search'] as const,
  search: (query: string) => [...browserSuggestionKeys.searches(), query] as const,
}

/** The desktop browser's known sessions, saved sign-ins and imported sites, read over IPC. */
export function useBrowserSuggestionSources(enabled: boolean) {
  return useQuery({
    queryKey: browserSuggestionKeys.sources(),
    queryFn: loadBrowserSuggestionSources,
    enabled,
    staleTime: BROWSER_SUGGESTION_SOURCES_STALE_TIME,
  })
}

/** Live search completions for `query`, already trimmed, from the desktop shell. */
export function useBrowserSearchSuggestions(query: string, enabled: boolean) {
  // rq-lint-allow: the desktop IPC takes no AbortSignal, so there is nothing to forward
  return useQuery({
    queryKey: browserSuggestionKeys.search(query),
    queryFn: () => loadBrowserSearchSuggestions(query),
    enabled,
    staleTime: BROWSER_SEARCH_SUGGESTIONS_STALE_TIME,
  })
}
