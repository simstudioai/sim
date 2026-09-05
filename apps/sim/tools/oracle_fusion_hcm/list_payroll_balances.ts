import { listCommon, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_PAYROLL_BALANCES_OUTPUTS,
  type OracleFusionHcmListPayrollBalancesParams,
  type OracleFusionHcmListPayrollBalancesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListPayrollBalancesTool: InternalToolConfig<
  OracleFusionHcmListPayrollBalancesParams,
  OracleFusionHcmListPayrollBalancesResponse
> = {
  id: 'oracle_fusion_hcm_list_payroll_balances',
  name: 'List Payroll Balances in Oracle Fusion HCM',
  description: 'Read one page of payroll balances from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    objectActionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object action ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_PAYROLL_BALANCES_OUTPUTS,
}
