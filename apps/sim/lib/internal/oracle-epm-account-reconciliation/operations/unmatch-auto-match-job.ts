import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationUnmatchAutoMatchJobParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_unmatch_automatch_job.html */
export const executeOracleEpmAccountReconciliationUnmatchAutoMatchJobOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationUnmatchAutoMatchJobParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.unmatch_auto_match_job,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'matching',
        'unmatchtransactionsbyautomatch',
        filterUndefined({
          autoMatchJobId: params.autoMatchJobId,
          createReverseAdjustment: params.createReverseAdjustment,
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
