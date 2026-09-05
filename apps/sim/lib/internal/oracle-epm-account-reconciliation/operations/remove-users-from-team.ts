import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationRemoveUsersFromTeamParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/lcm_remove_user_from_team_arcs.html */
export const executeOracleEpmAccountReconciliationRemoveUsersFromTeamOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationRemoveUsersFromTeamParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.remove_users_from_team,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'compliance',
        'REMOVE_USERS_FROM_TEAM',
        filterUndefined({
          fileName: params.fileName,
          teamName: params.teamName,
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
