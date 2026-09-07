'use client'

import { useCallback } from 'react'
import { useQueryStates } from 'nuqs'
import {
  CLEARED_SEARCH_FILTERS,
  composerModeParsers,
  type MothershipMode,
  resourceUrlKeys,
} from '@/app/workspace/[workspaceId]/home/search-params'
import { useMemberAccessAvailable } from '@/hooks/use-member-access'

/**
 * The composer's mode, read from and written to the URL's `mode` param so a
 * refresh, back, forward, or shared link lands in the same mode, as Glean's
 * separate Search and Assistant routes do. Build is the clean URL.
 *
 * Search and Assistant both answer from the workspace's indexed sources, so
 * both exist only where per-member access is on. With the feature off the mode
 * reads Build whatever the URL says, and a write to either is dropped rather
 * than leaving a mode in the URL that the next read would contradict.
 */
export function useMothershipMode() {
  const memberAccessAvailable = useMemberAccessAvailable()
  const [{ mode }, setParams] = useQueryStates(composerModeParsers, resourceUrlKeys)
  const setMode = useCallback(
    async (next: MothershipMode) => {
      if (next !== 'build' && !memberAccessAvailable) return
      await setParams(
        {
          mode: next,
          ...(next === 'search' ? {} : { q: null, ...CLEARED_SEARCH_FILTERS }),
        },
        { history: 'replace', scroll: false }
      )
    },
    [memberAccessAvailable, setParams]
  )

  return [memberAccessAvailable ? mode : 'build', setMode] as const
}
