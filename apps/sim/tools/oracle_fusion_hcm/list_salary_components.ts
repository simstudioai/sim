import { listCommon, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_SALARY_COMPONENTS_OUTPUTS,
  type OracleFusionHcmListSalaryComponentsParams,
  type OracleFusionHcmListSalaryComponentsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListSalaryComponentsTool: InternalToolConfig<
  OracleFusionHcmListSalaryComponentsParams,
  OracleFusionHcmListSalaryComponentsResponse
> = {
  id: 'oracle_fusion_hcm_list_salary_components',
  name: 'List Salary Components in Oracle Fusion HCM',
  description: 'Read one page of salary components from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    salaryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Salary ID, as a positive decimal string',
    },
    componentKind: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Component family: standard, simple, or rate; each is independently paginated',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_SALARY_COMPONENTS_OUTPUTS,
}
