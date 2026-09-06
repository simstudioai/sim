import { internalExecution, listCommon } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_PAYROLL_ELEMENT_DEFINITIONS_OUTPUTS,
  type OracleFusionHcmListPayrollElementDefinitionsParams,
  type OracleFusionHcmListPayrollElementDefinitionsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListPayrollElementDefinitionsTool: InternalToolConfig<
  OracleFusionHcmListPayrollElementDefinitionsParams,
  OracleFusionHcmListPayrollElementDefinitionsResponse
> = {
  id: 'oracle_fusion_hcm_list_payroll_element_definitions',
  name: 'List Payroll Element Definitions in Oracle Fusion HCM',
  description:
    'Read one page of payroll element definitions from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    personId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Person ID, as a positive decimal string',
    },
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
  outputs: ORACLE_FUSION_HCM_LIST_PAYROLL_ELEMENT_DEFINITIONS_OUTPUTS,
}
