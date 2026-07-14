'use client'

import { useCallback } from 'react'
import { debounce, useQueryState } from 'nuqs'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import {
  settingsSearchParam,
  settingsSearchUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/search-params'

/**
 * The shared `?search=` binding for settings list search boxes (teammates,
 * api-keys, copilot, custom-tools, mcp, secrets, workflow-mcp-servers). The
 * value updates instantly (drives the controlled input and the in-memory
 * filter); only the URL write is debounced. The setter is `void`-returning so
 * it passes straight to `SettingsPanel`'s `search.onChange`.
 */
export function useSettingsSearch(): [string, (value: string) => void] {
  const [searchTerm, setSearchTermParam] = useQueryState(settingsSearchParam.key, {
    ...settingsSearchParam.parser,
    ...settingsSearchUrlKeys,
    limitUrlUpdates: debounce(SEARCH_DEBOUNCE_MS),
  })
  const setSearchTerm = useCallback(
    (value: string) => void setSearchTermParam(value),
    [setSearchTermParam]
  )
  return [searchTerm, setSearchTerm]
}
