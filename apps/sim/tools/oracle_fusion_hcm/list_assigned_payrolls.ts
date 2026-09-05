import { listCommon, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_ASSIGNED_PAYROLLS_OUTPUTS,
  type OracleFusionHcmListAssignedPayrollsParams,
  type OracleFusionHcmListAssignedPayrollsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListAssignedPayrollsTool: InternalToolConfig<
  OracleFusionHcmListAssignedPayrollsParams,
  OracleFusionHcmListAssignedPayrollsResponse
> = {
  id: 'oracle_fusion_hcm_list_assigned_payrolls',
  name: 'List Assigned Payrolls in Oracle Fusion HCM',
  description: 'Read one page of assigned payrolls from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
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
  outputs: ORACLE_FUSION_HCM_LIST_ASSIGNED_PAYROLLS_OUTPUTS,
}
