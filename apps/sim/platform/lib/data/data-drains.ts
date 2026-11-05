'use client'

import { useQueryState } from 'nuqs'
import { dataDrainIdParam, dataDrainIdUrlKeys } from '@/ee/data-drains/search-params'

export type { CreateDataDrainBody, DataDrain, DataDrainRun } from '@/lib/api/contracts/data-drains'
export { CADENCE_TYPES, DESTINATION_TYPES, SOURCE_TYPES } from '@/lib/data-drains/types'
export { formatFileSize } from '@/lib/uploads/utils/file-size'
export {
  DESTINATION_SPECS,
  type DestinationField,
  type DestinationState,
} from '@/ee/data-drains/destinations/specs'
export {
  useCreateDataDrain,
  useDataDrainRuns,
  useDataDrains,
  useDeleteDataDrain,
  useRunDataDrainNow,
  useTestDataDrain,
  useUpdateDataDrain,
} from '@/ee/data-drains/hooks/data-drains'
export {
  CADENCE_LABELS,
  CADENCE_OPTIONS,
  DESTINATION_LABELS,
  DESTINATION_OPTIONS,
  SOURCE_LABELS,
  SOURCE_OPTIONS,
} from '@/ee/data-drains/labels'
export { useSettingsSearch } from '@/hooks/use-settings-search'

/** The drain being viewed, on the same URL key as the legacy page. */
export function useDataDrainParam() {
  return useQueryState(dataDrainIdParam.key, { ...dataDrainIdParam.parser, ...dataDrainIdUrlKeys })
}
