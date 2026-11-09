'use client'

import { useQueryState } from 'nuqs'
import { customBlockIdParam, customBlockIdUrlKeys } from '@/lib/settings/search-params'

/** The custom block open in the detail view. */
export function useCustomBlockParam() {
  return useQueryState(customBlockIdParam.key, {
    ...customBlockIdParam.parser,
    ...customBlockIdUrlKeys,
  })
}
