'use client'

import { useQueryState } from 'nuqs'
import { forkSyncDirectionParam, forkSyncDirectionUrlKeys } from '@/lib/settings/search-params'

/** The open sync detail's direction, shareable so a copied link opens the same side. */
export function useForkSyncDirectionParam() {
  return useQueryState(forkSyncDirectionParam.key, {
    ...forkSyncDirectionParam.parser,
    ...forkSyncDirectionUrlKeys,
  })
}
