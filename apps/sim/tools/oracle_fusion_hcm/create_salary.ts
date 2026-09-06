import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_CREATE_SALARY_OUTPUTS,
  type OracleFusionHcmCreateSalaryParams,
  type OracleFusionHcmCreateSalaryResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmCreateSalaryTool: InternalToolConfig<
  OracleFusionHcmCreateSalaryParams,
  OracleFusionHcmCreateSalaryResponse
> = {
  id: 'oracle_fusion_hcm_create_salary',
  name: 'Create Salary in Oracle Fusion HCM',
  description:
    'Administratively create an effective-dated salary for a user-entered salary basis. Does not submit an approval request or support component-calculated salary bases.',
  ...internalExecution,
  params: {
    ...common,
    assignmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'HR assignment ID (not payroll assignment ID), as a positive decimal string',
    },
    salaryBasisId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Salary basis ID, as a positive decimal string',
    },
    salaryAmount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Nonnegative salary amount in the salary basis currency and frequency; administrative write, not an approval request',
    },
    dateFrom: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Date from in YYYY-MM-DD format',
    },
    dateTo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Date to in YYYY-MM-DD format',
    },
  },
  outputs: ORACLE_FUSION_HCM_CREATE_SALARY_OUTPUTS,
}
