import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationListPeriodsParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_PERIODS_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationListPeriodsTool: InternalToolConfig<
  OracleEpmAccountReconciliationListPeriodsParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_list_periods',
  name: 'Oracle EPM Account Reconciliation List Periods',
  description: 'List Account Reconciliation periods with a selected status.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Period status filter',
      default: 'ALL',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ARCS_PERIODS_OUTPUTS,
}
