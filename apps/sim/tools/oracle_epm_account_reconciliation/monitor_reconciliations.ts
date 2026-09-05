import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationMonitorReconciliationsParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_MONITOR_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationMonitorReconciliationsTool: InternalToolConfig<
  OracleEpmAccountReconciliationMonitorReconciliationsParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_monitor_reconciliations',
  name: 'Oracle EPM Account Reconciliation Monitor Reconciliations',
  description: 'Check whether all reconciliations selected by a public filter are closed.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    periodName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reconciliation period name',
    },
    filterName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of a public reconciliation filter',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ARCS_MONITOR_OUTPUTS,
}
