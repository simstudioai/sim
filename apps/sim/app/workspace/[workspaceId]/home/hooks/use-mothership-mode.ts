'use client'

import { useQueryState } from 'nuqs'
import { modeParam } from '@/app/workspace/[workspaceId]/home/search-params'

/**
 * The composer's mode, read from and written to the URL's `mode` param so a
 * refresh, back, forward, or shared link lands in the same mode, as Glean's
 * separate Search and Assistant routes do. Build is the clean URL.
 */
export function useMothershipMode() {
  return useQueryState(modeParam.key, modeParam.parser)
}
