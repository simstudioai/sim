import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationSetPeriodStatusParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_change_period_status.html */
export const executeOracleEpmAccountReconciliationSetPeriodStatusOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationSetPeriodStatusParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.set_period_status,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'compliance',
        'SET_PERIOD_STATUS',
        filterUndefined({
          period: params.period,
          status: params.status,
        }),
        {
          waitForCompletion: params.waitForCompletion,
          maxWaitSeconds: params.maxWaitSeconds,
          periodStatus: params.status,
        },
        signal
      )
  )
