'use client'

import { useCallback } from 'react'
import { useQueryStates } from 'nuqs'
import {
  CLEARED_SEARCH_FILTERS,
  composerModeParsers,
  type MothershipMode,
  resourceUrlKeys,
} from '@/app/workspace/[workspaceId]/home/search-params'

/**
 * The composer's mode, read from and written to the URL's `mode` param so a
 * refresh, back, forward, or shared link lands in the same mode, as Glean's
 * separate Search and Assistant routes do. Build is the clean URL.
 */
export function useMothershipMode() {
  const [{ mode }, setParams] = useQueryStates(composerModeParsers, resourceUrlKeys)
  const setMode = useCallback(
    (next: MothershipMode) =>
      setParams(
        {
          mode: next,
          ...(next === 'search' ? {} : { q: null, ...CLEARED_SEARCH_FILTERS }),
        },
        { history: 'replace', scroll: false }
      ),
    [setParams]
  )

  return [mode, setMode] as const
}
