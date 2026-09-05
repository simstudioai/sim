import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationPurgeMatchedTransactionsParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_MATCHING_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationPurgeMatchedTransactionsTool: InternalToolConfig<
  OracleEpmAccountReconciliationPurgeMatchedTransactionsParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_purge_matched_transactions',
  name: 'Oracle EPM Account Reconciliation Purge Matched Transactions',
  description: 'Permanently purge matched transactions older than the specified age.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    matchTypeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text ID of the Transaction Matching match type',
    },
    age: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Age in days of matched transactions to purge',
    },
    filterOperator: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account ID filter operator; provide with filterValue',
    },
    filterValue: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Account ID filter values as a JSON string array',
    },
    logFileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional output log filename',
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
  outputs: ARCS_MATCHING_OUTPUTS,
}
