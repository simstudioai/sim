import {
  effectiveDate,
  internalExecution,
  listCommon,
  personId,
  search,
} from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_ABSENCE_TYPES_OUTPUTS,
  type OracleFusionHcmListAbsenceTypesParams,
  type OracleFusionHcmListAbsenceTypesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListAbsenceTypesTool: InternalToolConfig<
  OracleFusionHcmListAbsenceTypesParams,
  OracleFusionHcmListAbsenceTypesResponse
> = {
  id: 'oracle_fusion_hcm_list_absence_types',
  name: 'List Oracle Fusion HCM Absence Types',
  description: 'List absence types available to a worker.',
  ...internalExecution,
  params: { ...listCommon, ...personId, ...search, ...effectiveDate },
  outputs: ORACLE_FUSION_HCM_LIST_ABSENCE_TYPES_OUTPUTS,
}
