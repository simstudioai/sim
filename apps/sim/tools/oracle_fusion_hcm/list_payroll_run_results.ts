import { internalExecution, listCommon } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_PAYROLL_RUN_RESULTS_OUTPUTS,
  type OracleFusionHcmListPayrollRunResultsParams,
  type OracleFusionHcmListPayrollRunResultsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListPayrollRunResultsTool: InternalToolConfig<
  OracleFusionHcmListPayrollRunResultsParams,
  OracleFusionHcmListPayrollRunResultsResponse
> = {
  id: 'oracle_fusion_hcm_list_payroll_run_results',
  name: 'List Payroll Run Results in Oracle Fusion HCM',
  description:
    'Read one page of payroll run results from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
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
  outputs: ORACLE_FUSION_HCM_LIST_PAYROLL_RUN_RESULTS_OUTPUTS,
}
