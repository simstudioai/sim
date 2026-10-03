import type { OracleEpmClient } from '@/lib/internal/oracle-epm'
import {
  ArcsContractError,
  arcsInputSchemas,
  arcsPeriodsSchema,
  arcsStatusSchema,
  executeArcsOperation,
  parseArcsResponse,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { arcsRoutes } from '@/lib/internal/oracle-epm-account-reconciliation/routes'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationListPeriodsParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Shared listing primitive for the tool and credential-bound server selector. */
export async function listArcsPeriods(
  client: OracleEpmClient,
  status: 'ALL' | 'OPEN' | 'CLOSED' | 'LOCKED' | 'PENDING' | 'OPEN_PENDING' = 'ALL',
  signal?: AbortSignal
) {
  const response = await client.request(arcsRoutes.periods, { query: { status }, signal })
  if (parseArcsResponse(arcsStatusSchema, response).status !== 0)
    throw new ArcsContractError('Oracle EPM could not list periods')
  return parseArcsResponse(arcsPeriodsSchema, response)
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_get_periods.html */
export const executeOracleEpmAccountReconciliationListPeriodsOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationListPeriodsParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.list_periods,
    input,
    signal,
    context,
    async (params, client, signal) => {
      const result = await listArcsPeriods(client, params.status ?? 'ALL', signal)
      return {
        success: true,
        output: { status: result.status, details: result.details ?? null, periods: result.items },
      }
    }
  )
