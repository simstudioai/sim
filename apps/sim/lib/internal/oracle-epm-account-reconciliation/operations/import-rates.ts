import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationImportRatesParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_import_currency_rates.html */
export const executeOracleEpmAccountReconciliationImportRatesOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationImportRatesParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.import_rates,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'compliance',
        'IMPORT_RATES',
        filterUndefined({
          file: params.fileName,
          period: params.period,
          rateType: params.rateType,
          importType: params.importType,
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
