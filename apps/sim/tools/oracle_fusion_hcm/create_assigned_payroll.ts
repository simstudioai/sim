import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_CREATE_ASSIGNED_PAYROLL_OUTPUTS,
  type OracleFusionHcmCreateAssignedPayrollParams,
  type OracleFusionHcmCreateAssignedPayrollResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmCreateAssignedPayrollTool: InternalToolConfig<
  OracleFusionHcmCreateAssignedPayrollParams,
  OracleFusionHcmCreateAssignedPayrollResponse
> = {
  id: 'oracle_fusion_hcm_create_assigned_payroll',
  name: 'Create Assigned Payroll in Oracle Fusion HCM',
  description: 'Create Assigned Payroll using documented Oracle fields. Requires administrative privileges and valid tenant configuration.',
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
    payrollId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Payroll ID, as a positive decimal string',
    },
    effectiveStartDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Effective start date in YYYY-MM-DD format',
    },
    effectiveEndDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Effective end date in YYYY-MM-DD format',
    },
    startDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start date in YYYY-MM-DD format',
    },
    endDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End date in YYYY-MM-DD format',
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
  outputs: ORACLE_FUSION_HCM_CREATE_ASSIGNED_PAYROLL_OUTPUTS,
}
