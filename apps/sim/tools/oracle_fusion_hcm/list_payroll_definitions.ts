import { internalExecution, listCommon } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_PAYROLL_DEFINITIONS_OUTPUTS,
  type OracleFusionHcmListPayrollDefinitionsParams,
  type OracleFusionHcmListPayrollDefinitionsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListPayrollDefinitionsTool: InternalToolConfig<
  OracleFusionHcmListPayrollDefinitionsParams,
  OracleFusionHcmListPayrollDefinitionsResponse
> = {
  id: 'oracle_fusion_hcm_list_payroll_definitions',
  name: 'List Payroll Definitions in Oracle Fusion HCM',
  description:
    'Read one page of payroll definitions from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    legislativeDataGroupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Legislative data group ID, as a positive decimal string',
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
  outputs: ORACLE_FUSION_HCM_LIST_PAYROLL_DEFINITIONS_OUTPUTS,
}
