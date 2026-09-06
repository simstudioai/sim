import { internalExecution, listCommon } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_PAYROLL_ASSIGNMENTS_OUTPUTS,
  type OracleFusionHcmListPayrollAssignmentsParams,
  type OracleFusionHcmListPayrollAssignmentsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListPayrollAssignmentsTool: InternalToolConfig<
  OracleFusionHcmListPayrollAssignmentsParams,
  OracleFusionHcmListPayrollAssignmentsResponse
> = {
  id: 'oracle_fusion_hcm_list_payroll_assignments',
  name: 'List Payroll Assignments in Oracle Fusion HCM',
  description:
    'Read one page of payroll assignments from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    payrollRelationshipId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Payroll relationship ID, as a positive decimal string',
    },
    effectiveDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Effective date in YYYY-MM-DD format',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_PAYROLL_ASSIGNMENTS_OUTPUTS,
}
