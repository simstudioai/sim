import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationRunProfileRulesParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_run_profile_rule.html */
export const executeOracleEpmAccountReconciliationRunProfileRulesOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationRunProfileRulesParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.run_profile_rules,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'compliance',
        'RUN_PROFILE_RULES',
        filterUndefined({
          period: params.period,
          filter: params.filter,
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
