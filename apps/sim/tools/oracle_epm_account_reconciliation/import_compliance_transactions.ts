import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationImportComplianceTransactionsParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_JOB_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationImportComplianceTransactionsTool: InternalToolConfig<
  OracleEpmAccountReconciliationImportComplianceTransactionsParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_import_compliance_transactions',
  name: 'Oracle EPM Account Reconciliation Import Compliance Transactions',
  description: 'Import pre-mapped Reconciliation Compliance transactions from a staged file.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact staged transaction filename',
    },
    period: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reconciliation period name, not its internal ID',
    },
    transactionType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'BEX balance explanations, SRC/SUB adjustments, or VEX variance explanations',
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
  outputs: ARCS_JOB_OUTPUTS,
}
