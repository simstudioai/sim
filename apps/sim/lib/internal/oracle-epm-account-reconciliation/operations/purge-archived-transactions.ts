import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationPurgeArchivedTransactionsParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_purge_archived_transactions.html */
export const executeOracleEpmAccountReconciliationPurgeArchivedTransactionsOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationPurgeArchivedTransactionsParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.purge_archived_transactions,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'matching',
        'purgearchivetransactions',
        filterUndefined({
          jobId: params.jobId,
          logFileName: params.logFileName,
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
