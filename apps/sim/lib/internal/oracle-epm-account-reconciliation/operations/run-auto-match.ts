import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationRunAutoMatchParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_tm_automatch.html */
export const executeOracleEpmAccountReconciliationRunAutoMatchOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationRunAutoMatchParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.run_auto_match,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'matching',
        'runautomatch',
        filterUndefined({
          matchTypeId: params.matchTypeId,
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
