'use client'

import { useQueryState } from 'nuqs'
import { dataDrainIdParam, dataDrainIdUrlKeys } from '@/ee/data-drains/search-params'

/** The drain being viewed. */
export function useDataDrainParam() {
  return useQueryState(dataDrainIdParam.key, { ...dataDrainIdParam.parser, ...dataDrainIdUrlKeys })
}
