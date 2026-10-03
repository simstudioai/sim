import { internalExecution, listCommon } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_PAYROLL_INPUT_VALUES_OUTPUTS,
  type OracleFusionHcmListPayrollInputValuesParams,
  type OracleFusionHcmListPayrollInputValuesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListPayrollInputValuesTool: InternalToolConfig<
  OracleFusionHcmListPayrollInputValuesParams,
  OracleFusionHcmListPayrollInputValuesResponse
> = {
  id: 'oracle_fusion_hcm_list_payroll_input_values',
  name: 'List Payroll Input Values in Oracle Fusion HCM',
  description:
    'Read one page of payroll input values from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    elementTypeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Element type ID, as a positive decimal string',
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
  outputs: ORACLE_FUSION_HCM_LIST_PAYROLL_INPUT_VALUES_OUTPUTS,
}
