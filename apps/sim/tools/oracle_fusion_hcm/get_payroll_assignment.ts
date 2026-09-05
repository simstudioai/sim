import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_GET_PAYROLL_ASSIGNMENT_OUTPUTS,
  type OracleFusionHcmGetPayrollAssignmentParams,
  type OracleFusionHcmGetPayrollAssignmentResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmGetPayrollAssignmentTool: InternalToolConfig<
  OracleFusionHcmGetPayrollAssignmentParams,
  OracleFusionHcmGetPayrollAssignmentResponse
> = {
  id: 'oracle_fusion_hcm_get_payroll_assignment',
  name: 'Get Payroll Assignment in Oracle Fusion HCM',
  description: 'Read an Oracle Fusion HCM payroll assignment by its documented ID, subject to tenant data access.',
  ...internalExecution,
  params: {
    ...common,
    payrollRelationshipId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Payroll relationship ID, as a positive decimal string',
    },
    payrollAssignmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Payroll assignment RelationshipGroupId, not the HR AssignmentId; positive decimal string',
    },
    effectiveDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Effective date in YYYY-MM-DD format',
    },
  },
  outputs: ORACLE_FUSION_HCM_GET_PAYROLL_ASSIGNMENT_OUTPUTS,
}
