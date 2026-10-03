import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationImportReconciliationAttributesParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_import_recon_attributs.html */
export const executeOracleEpmAccountReconciliationImportReconciliationAttributesOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationImportReconciliationAttributesParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.import_reconciliation_attributes,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'compliance',
        'IMPORT_RECONCILIATION_ATTRIBUTES',
        filterUndefined({
          fileName: params.fileName,
          period: params.period,
          rules: params.rules,
          reopen: params.reopen === undefined ? undefined : String(params.reopen),
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
