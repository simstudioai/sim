import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationImportProfilesParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_import_profiles.html */
export const executeOracleEpmAccountReconciliationImportProfilesOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationImportProfilesParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.import_profiles,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'compliance',
        'IMPORT_PROFILES',
        filterUndefined({
          fileLocation: params.fileName,
          importType: params.importType,
          profileType: params.profileType,
          dateFormat: params.dateFormat,
          period: params.period,
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
