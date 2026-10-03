import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationUnmatchTransactionsParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_unmatch_transactions.html */
export const executeOracleEpmAccountReconciliationUnmatchTransactionsOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationUnmatchTransactionsParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.unmatch_transactions,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'matching',
        'unmatchtransactions',
        filterUndefined({
          matchTypeId: params.matchTypeId,
          matchIds: params.matchIds,
          forceReopen: params.forceReopen,
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
