import { useCallback, useState } from 'react'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { useDebounce } from '@/hooks/use-debounce'

/** A picker's typed search and the settled value that reaches a provider-backed list. */
export interface SelectorSearch {
  /** What the viewer has typed, shown in the search field. */
  query: string
  setQuery: (query: string) => void
  /**
   * The search sent to the list: debounced while typing, cleared at once so a pick that resets the
   * query brings back the full list without waiting out the delay.
   */
  activeSearch: string
  /** The debounced value alone, true while a settled search narrows the list. */
  debouncedSearch: string
  reset: () => void
}

/**
 * Debounces a picker's search before it enters a selector's query key: several provider lists are
 * rate limited, so a request per keystroke is not an option.
 */
export function useSelectorSearch(): SelectorSearch {
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const debouncedSearch = useDebounce(trimmed, SEARCH_DEBOUNCE_MS)
  const reset = useCallback(() => setQuery(''), [])
  return {
    query,
    setQuery,
    activeSearch: trimmed === '' ? '' : debouncedSearch,
    debouncedSearch,
    reset,
  }
}
