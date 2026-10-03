import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_GET_ASSIGNED_PAYROLL_OUTPUTS,
  type OracleFusionHcmGetAssignedPayrollParams,
  type OracleFusionHcmGetAssignedPayrollResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmGetAssignedPayrollTool: InternalToolConfig<
  OracleFusionHcmGetAssignedPayrollParams,
  OracleFusionHcmGetAssignedPayrollResponse
> = {
  id: 'oracle_fusion_hcm_get_assigned_payroll',
  name: 'Get Assigned Payroll in Oracle Fusion HCM',
  description:
    'Read an Oracle Fusion HCM assigned payroll by its documented ID, subject to tenant data access.',
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
      description:
        'Payroll assignment RelationshipGroupId, not the HR AssignmentId; positive decimal string',
    },
    assignedPayrollId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Assigned payroll ID, as a positive decimal string',
    },
    effectiveDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Effective date in YYYY-MM-DD format',
    },
  },
  outputs: ORACLE_FUSION_HCM_GET_ASSIGNED_PAYROLL_OUTPUTS,
}
