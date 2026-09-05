import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationImportPremappedBalancesParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_import_pre_mapped_balances.html */
export const executeOracleEpmAccountReconciliationImportPremappedBalancesOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationImportPremappedBalancesParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.import_premapped_balances,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'compliance',
        'IMPORT_PREMAPPED_BALANCES',
        filterUndefined({
          file: params.fileName,
          period: params.period,
          balanceType: params.balanceType,
          currencyBucket: params.currencyBucket,
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
