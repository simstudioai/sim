import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationArchiveMatchedTransactionsParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_archive_matched_transactions.html */
export const executeOracleEpmAccountReconciliationArchiveMatchedTransactionsOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationArchiveMatchedTransactionsParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.archive_matched_transactions,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'matching',
        'archivetransactions',
        filterUndefined({
          matchTypeId: params.matchTypeId,
          age: params.age,
          filterOperator: params.filterOperator,
          filterValue: params.filterValue,
          logFileName: params.logFileName,
          fileName: params.fileName,
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
