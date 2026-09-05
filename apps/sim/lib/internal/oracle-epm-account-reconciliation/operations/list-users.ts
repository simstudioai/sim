import { filterUndefined } from '@sim/utils/object'
import {
  arcsInputSchemas,
  arcsUsersSchema,
  executeArcsOperation,
  parseArcsResponse,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { arcsRoutes } from '@/lib/internal/oracle-epm-account-reconciliation/routes'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationListUsersParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/lcm_list_users.html */
export const executeOracleEpmAccountReconciliationListUsersOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationListUsersParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.list_users,
    input,
    signal,
    context,
    async (params, client, signal) => {
      const result = parseArcsResponse(
        arcsUsersSchema,
        await client.request(arcsRoutes.users, {
          json: filterUndefined({
            userlogin: params.userlogin,
            userattribute: params.userattribute,
            epmgroups: params.epmgroups,
            idcsgroups: params.idcsgroups,
            applicationroles: params.applicationroles,
            granularroles: params.granularroles,
            indirect: params.indirect,
          }),
          signal,
        })
      )
      if (result.status !== 0)
        return {
          success: false,
          error: 'Oracle EPM could not list users',
          output: { status: result.status },
        }
      return { success: true, output: { status: result.status, users: result.details ?? [] } }
    }
  )
