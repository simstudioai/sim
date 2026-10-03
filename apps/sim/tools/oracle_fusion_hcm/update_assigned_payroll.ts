import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_UPDATE_ASSIGNED_PAYROLL_OUTPUTS,
  type OracleFusionHcmUpdateAssignedPayrollParams,
  type OracleFusionHcmUpdateAssignedPayrollResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmUpdateAssignedPayrollTool: InternalToolConfig<
  OracleFusionHcmUpdateAssignedPayrollParams,
  OracleFusionHcmUpdateAssignedPayrollResponse
> = {
  id: 'oracle_fusion_hcm_update_assigned_payroll',
  name: 'Update Assigned Payroll in Oracle Fusion HCM',
  description:
    'Correct or effectively update an assigned-payroll record. Does not transfer the worker to another payroll or execute a payroll process.',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'Effective date in YYYY-MM-DD format',
    },
    rangeMode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'CORRECTION changes the historical row; UPDATE starts an effective-dated change',
    },
    effectiveEndDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Effective end date in YYYY-MM-DD format',
    },
    lsed: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lsed in YYYY-MM-DD format',
    },
    overridingPeriodId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Overriding period ID, as a positive decimal string',
    },
    timeCardRequired: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Oracle time-card requirement code, such as Y or N',
    },
  },
  outputs: ORACLE_FUSION_HCM_UPDATE_ASSIGNED_PAYROLL_OUTPUTS,
}
