import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationImportComplianceTransactionsParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_import_premapped_transactions.html */
export const executeOracleEpmAccountReconciliationImportComplianceTransactionsOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationImportComplianceTransactionsParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.import_compliance_transactions,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'compliance',
        'IMPORT_PREMAPPED_TRANSACTIONS',
        filterUndefined({
          file: params.fileName,
          period: params.period,
          transactionType: params.transactionType,
          dateFormat: params.dateFormat,
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
