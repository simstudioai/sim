import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationResponse,
  OracleEpmAccountReconciliationUnmatchTransactionsParams,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_MATCHING_LOG_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationUnmatchTransactionsTool: InternalToolConfig<
  OracleEpmAccountReconciliationUnmatchTransactionsParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_unmatch_transactions',
  name: 'Oracle EPM Account Reconciliation Unmatch Transactions',
  description: 'Unmatch up to 10,000 specified matches in a match type.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    matchTypeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text ID of the Transaction Matching match type',
    },
    matchIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON array of numeric match IDs (maximum 10,000)',
    },
    forceReopen: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reopen affected reconciliations when required',
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
  outputs: ARCS_MATCHING_LOG_OUTPUTS,
}
