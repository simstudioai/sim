import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationPurgeMatchedTransactionsParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_tm_purge_transactions.html */
export const executeOracleEpmAccountReconciliationPurgeMatchedTransactionsOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationPurgeMatchedTransactionsParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.purge_matched_transactions,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'matching',
        'purgetransactions',
        filterUndefined({
          matchTypeId: params.matchTypeId,
          age: params.age,
          filterOperator: params.filterOperator,
          filterValue: params.filterValue,
          logFileName: params.logFileName,
          matchedStatus: 'matched',
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
