import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationImportMatchingTransactionsParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_MATCHING_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationImportMatchingTransactionsTool: InternalToolConfig<
  OracleEpmAccountReconciliationImportMatchingTransactionsParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_import_matching_transactions',
  name: 'Oracle EPM Account Reconciliation Import Matching Transactions',
  description: 'Import pre-mapped transactions into a Transaction Matching data source.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact staged transaction filename',
    },
    matchTypeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text ID of the Transaction Matching match type',
    },
    dataSource: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the Transaction Matching data source',
    },
    dateFormat: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Date format used in the import file, for example MMM d, yyyy',
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
