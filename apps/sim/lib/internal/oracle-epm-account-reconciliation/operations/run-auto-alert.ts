import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationRunAutoAlertParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_tm_autoalert.html */
export const executeOracleEpmAccountReconciliationRunAutoAlertOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationRunAutoAlertParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.run_auto_alert,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'matching',
        'runautoalert',
        filterUndefined({
          matchTypeId: params.matchTypeId,
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
