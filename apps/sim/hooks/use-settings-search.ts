'use client'

import { useQueryState } from 'nuqs'
import { parseAsString } from 'nuqs/server'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

const SETTINGS_SEARCH_KEY = 'search'
const SETTINGS_SEARCH_PARSER = parseAsString.withDefault('')

/** Search view-state: clean URLs, no back-stack churn. */
const SETTINGS_SEARCH_URL_KEYS = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
} as const

/**
 * The shared `?search=` binding for settings list search boxes (teammates,
 * api-keys, byok, copilot, custom-tools, mcp, secrets, workflow-mcp-servers,
 * and the ee sections: audit-logs, access-control, custom-blocks, data-drains,
 * forks).
 * Composes `useDebouncedSearchSetter`, so it carries the canonical semantics:
 * the value updates instantly (drives the controlled input and the in-memory
 * filter), non-empty URL writes are debounced, and clearing (or a
 * whitespace-only value) strips the param immediately. The setter is
 * `void`-returning so it passes straight to `SettingsPanel`'s `search.onChange`. Settings sections
 * never co-render, so they all share the `search` key without collisions.
 */
export function useSettingsSearch(): [string, (value: string) => void] {
  const [searchTerm, setSearchTermParam] = useQueryState(SETTINGS_SEARCH_KEY, {
    ...SETTINGS_SEARCH_PARSER,
    ...SETTINGS_SEARCH_URL_KEYS,
  })
  const setSearchTerm = useDebouncedSearchSetter(setSearchTermParam)
  return [searchTerm, setSearchTerm]
}
