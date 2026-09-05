import { internalExecution, searchable } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_GRADES_OUTPUTS,
  type OracleFusionHcmListGradesParams,
  type OracleFusionHcmListGradesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListGradesTool: InternalToolConfig<
  OracleFusionHcmListGradesParams,
  OracleFusionHcmListGradesResponse
> = {
  id: 'oracle_fusion_hcm_list_grades',
  name: 'List Oracle Fusion HCM Grades',
  description: 'List or search grades.',
  ...internalExecution,
  params: searchable,
  outputs: ORACLE_FUSION_HCM_LIST_GRADES_OUTPUTS,
}
