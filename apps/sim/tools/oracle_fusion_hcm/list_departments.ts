import { internalExecution, searchable } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_DEPARTMENTS_OUTPUTS,
  type OracleFusionHcmListDepartmentsParams,
  type OracleFusionHcmListDepartmentsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListDepartmentsTool: InternalToolConfig<
  OracleFusionHcmListDepartmentsParams,
  OracleFusionHcmListDepartmentsResponse
> = {
  id: 'oracle_fusion_hcm_list_departments',
  name: 'List Oracle Fusion HCM Departments',
  description: 'List or search departments.',
  ...internalExecution,
  params: searchable,
  outputs: ORACLE_FUSION_HCM_LIST_DEPARTMENTS_OUTPUTS,
}
