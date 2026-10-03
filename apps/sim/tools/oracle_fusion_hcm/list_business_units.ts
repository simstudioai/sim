import { common, internalExecution, page, search } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_BUSINESS_UNITS_OUTPUTS,
  type OracleFusionHcmListBusinessUnitsParams,
  type OracleFusionHcmListBusinessUnitsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListBusinessUnitsTool: InternalToolConfig<
  OracleFusionHcmListBusinessUnitsParams,
  OracleFusionHcmListBusinessUnitsResponse
> = {
  id: 'oracle_fusion_hcm_list_business_units',
  name: 'List Oracle Fusion HCM Business Units',
  description: 'List or search business units.',
  ...internalExecution,
  params: { ...common, ...search, ...page },
  outputs: ORACLE_FUSION_HCM_LIST_BUSINESS_UNITS_OUTPUTS,
}
