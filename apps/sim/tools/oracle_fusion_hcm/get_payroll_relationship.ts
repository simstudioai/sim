import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_GET_PAYROLL_RELATIONSHIP_OUTPUTS,
  type OracleFusionHcmGetPayrollRelationshipParams,
  type OracleFusionHcmGetPayrollRelationshipResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmGetPayrollRelationshipTool: InternalToolConfig<
  OracleFusionHcmGetPayrollRelationshipParams,
  OracleFusionHcmGetPayrollRelationshipResponse
> = {
  id: 'oracle_fusion_hcm_get_payroll_relationship',
  name: 'Get Payroll Relationship in Oracle Fusion HCM',
  description: 'Read an Oracle Fusion HCM payroll relationship by its documented ID, subject to tenant data access.',
  ...internalExecution,
  params: {
    ...common,
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
  outputs: ORACLE_FUSION_HCM_GET_PAYROLL_RELATIONSHIP_OUTPUTS,
}
