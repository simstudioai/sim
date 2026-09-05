import { listCommon, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_PAYROLL_RELATIONSHIPS_OUTPUTS,
  type OracleFusionHcmListPayrollRelationshipsParams,
  type OracleFusionHcmListPayrollRelationshipsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListPayrollRelationshipsTool: InternalToolConfig<
  OracleFusionHcmListPayrollRelationshipsParams,
  OracleFusionHcmListPayrollRelationshipsResponse
> = {
  id: 'oracle_fusion_hcm_list_payroll_relationships',
  name: 'List Payroll Relationships in Oracle Fusion HCM',
  description: 'Read one page of payroll relationships from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    personNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Worker person number, including any leading zeros; does not require current public-directory membership',
    },
    effectiveDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Effective date in YYYY-MM-DD format',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search text (maximum 200 characters)',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_PAYROLL_RELATIONSHIPS_OUTPUTS,
}
