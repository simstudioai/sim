import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationImportBalancesParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_JOB_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationImportBalancesTool: InternalToolConfig<
  OracleEpmAccountReconciliationImportBalancesParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_import_balances',
  name: 'Oracle EPM Account Reconciliation Import Balances',
  description: 'Run an existing data-load definition to import balances for a period.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    period: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reconciliation period name, not its internal ID',
    },
    dataLoadDefinition: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the configured data-load definition',
    },
    waitForCompletion: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Wait for the accepted job to finish (default false)',
    },
    maxWaitSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum wait in seconds (5–300; default 60)',
      default: 60,
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ARCS_JOB_OUTPUTS,
}
