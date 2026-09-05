import { internalExecution, searchable } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_LOCATIONS_OUTPUTS,
  type OracleFusionHcmListLocationsParams,
  type OracleFusionHcmListLocationsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListLocationsTool: InternalToolConfig<
  OracleFusionHcmListLocationsParams,
  OracleFusionHcmListLocationsResponse
> = {
  id: 'oracle_fusion_hcm_list_locations',
  name: 'List Oracle Fusion HCM Locations',
  description: 'List or search work locations.',
  ...internalExecution,
  params: searchable,
  outputs: ORACLE_FUSION_HCM_LIST_LOCATIONS_OUTPUTS,
}
