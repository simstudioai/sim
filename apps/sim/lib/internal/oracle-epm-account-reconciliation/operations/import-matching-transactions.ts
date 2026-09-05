import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationImportMatchingTransactionsParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_import_tm_premapped_transactions.html */
export const executeOracleEpmAccountReconciliationImportMatchingTransactionsOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationImportMatchingTransactionsParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.import_matching_transactions,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'matching',
        'importtmpremappedtransactions',
        filterUndefined({
          file: params.fileName,
          matchTypeId: params.matchTypeId,
          dataSource: params.dataSource,
          dateFormat: params.dateFormat,
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
