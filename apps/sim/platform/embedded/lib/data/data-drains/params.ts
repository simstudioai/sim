'use client'

import { useQueryState } from 'nuqs'
import { dataDrainIdParam, dataDrainIdUrlKeys } from '@/ee/data-drains/search-params'

export function useDataDrainParam() {
  return useQueryState(dataDrainIdParam.key, { ...dataDrainIdParam.parser, ...dataDrainIdUrlKeys })
}
