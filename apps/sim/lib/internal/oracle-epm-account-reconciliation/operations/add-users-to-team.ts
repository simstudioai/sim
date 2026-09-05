import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { launchArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationAddUsersToTeamParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/lcm_add_user_to_team_arcs.html */
export const executeOracleEpmAccountReconciliationAddUsersToTeamOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationAddUsersToTeamParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.add_users_to_team,
    input,
    signal,
    context,
    (params, client, signal) =>
      launchArcsJob(
        client,
        'compliance',
        'ADD_USERS_TO_TEAM',
        filterUndefined({
          fileName: params.fileName,
          teamName: params.teamName,
        }),
        { waitForCompletion: params.waitForCompletion, maxWaitSeconds: params.maxWaitSeconds },
        signal
      )
  )
