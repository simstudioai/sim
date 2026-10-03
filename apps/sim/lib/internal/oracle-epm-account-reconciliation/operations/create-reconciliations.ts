import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationCreateReconciliationsParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_create_reconciliation.html */
export const executeOracleEpmAccountReconciliationCreateReconciliationsOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationCreateReconciliationsParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.create_reconciliations,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'compliance',
        'CREATE_RECONCILIATIONS',
        filterUndefined({
          period: params.period,
          filter: params.filter,
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
