'use client'

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
 * filter); only the URL write is debounced.
 */
export function useSettingsSearch() {
  return useQueryState(settingsSearchParam.key, {
    ...settingsSearchParam.parser,
    ...settingsSearchUrlKeys,
    limitUrlUpdates: debounce(SEARCH_DEBOUNCE_MS),
  })
}
