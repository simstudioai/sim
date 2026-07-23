'use client'

import { useQueryState } from 'nuqs'
import {
  settingsSearchParam,
  settingsSearchUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/search-params'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

/**
 * The shared `?search=` binding for settings list search boxes (teammates,
 * api-keys, byok, copilot, custom-tools, mcp, secrets, workflow-mcp-servers,
 * and the ee sections: audit-logs, access-control, custom-blocks, data-drains,
 * forks).
 * Composes `useDebouncedSearchSetter`, so it carries the canonical semantics:
 * the value updates instantly (drives the controlled input and the in-memory
 * filter), non-empty URL writes are debounced, and clearing (or a
 * whitespace-only value) strips the param immediately. The setter is
 * `void`-returning so it passes straight to `SettingsPanel`'s `search.onChange`.
 */
export function useSettingsSearch(): [string, (value: string) => void] {
  const [searchTerm, setSearchTermParam] = useQueryState(settingsSearchParam.key, {
    ...settingsSearchParam.parser,
    ...settingsSearchUrlKeys,
  })
  const setSearchTerm = useDebouncedSearchSetter(setSearchTermParam)
  return [searchTerm, setSearchTerm]
}
