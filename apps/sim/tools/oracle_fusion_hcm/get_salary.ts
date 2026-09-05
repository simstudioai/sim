import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_GET_SALARY_OUTPUTS,
  type OracleFusionHcmGetSalaryParams,
  type OracleFusionHcmGetSalaryResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmGetSalaryTool: InternalToolConfig<
  OracleFusionHcmGetSalaryParams,
  OracleFusionHcmGetSalaryResponse
> = {
  id: 'oracle_fusion_hcm_get_salary',
  name: 'Get Salary in Oracle Fusion HCM',
  description: 'Read an Oracle Fusion HCM salary by its documented ID, subject to tenant data access.',
  ...internalExecution,
  params: {
    ...common,
    salaryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Salary ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_GET_SALARY_OUTPUTS,
}
