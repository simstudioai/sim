import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationDeleteProfileParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_delete_profile.html */
export const executeOracleEpmAccountReconciliationDeleteProfileOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationDeleteProfileParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.delete_profile,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'compliance',
        'DELETE_PROFILE',
        filterUndefined({
          accountId: params.accountId,
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
