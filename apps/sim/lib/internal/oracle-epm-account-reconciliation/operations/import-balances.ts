import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationImportBalancesParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_import_balances.html */
export const executeOracleEpmAccountReconciliationImportBalancesOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationImportBalancesParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.import_balances,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'compliance',
        'IMPORT_BALANCES',
        filterUndefined({
          period: params.period,
          dl_Definition: params.dataLoadDefinition,
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
