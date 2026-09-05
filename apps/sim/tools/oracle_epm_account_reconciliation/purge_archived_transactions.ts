import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationPurgeArchivedTransactionsParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_MATCHING_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationPurgeArchivedTransactionsTool: InternalToolConfig<
  OracleEpmAccountReconciliationPurgeArchivedTransactionsParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_purge_archived_transactions',
  name: 'Oracle EPM Account Reconciliation Purge Archived Transactions',
  description: 'Permanently purge transactions from a completed archive job.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the completed archive job whose transactions will be purged',
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
