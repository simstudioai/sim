import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_CORRECT_SALARY_OUTPUTS,
  type OracleFusionHcmCorrectSalaryParams,
  type OracleFusionHcmCorrectSalaryResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmCorrectSalaryTool: InternalToolConfig<
  OracleFusionHcmCorrectSalaryParams,
  OracleFusionHcmCorrectSalaryResponse
> = {
  id: 'oracle_fusion_hcm_correct_salary',
  name: 'Correct Salary in Oracle Fusion HCM',
  description:
    'Correct the amount on an existing user-entered salary record. This changes that historical row; it does not create an effective-dated salary or submit an approval request.',
  ...internalExecution,
  params: {
    ...common,
    salaryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Salary ID, as a positive decimal string',
    },
    salaryAmount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Nonnegative salary amount in the salary basis currency and frequency; administrative write, not an approval request',
    },
  },
  outputs: ORACLE_FUSION_HCM_CORRECT_SALARY_OUTPUTS,
}
