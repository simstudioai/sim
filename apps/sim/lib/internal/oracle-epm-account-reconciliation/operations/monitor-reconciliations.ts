import {
  arcsInputSchemas,
  arcsStatusSchema,
  executeArcsOperation,
  parseArcsResponse,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { arcsRoutes } from '@/lib/internal/oracle-epm-account-reconciliation/routes'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationMonitorReconciliationsParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_rest_monitor_reconciliations.html */
export const executeOracleEpmAccountReconciliationMonitorReconciliationsOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationMonitorReconciliationsParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.monitor_reconciliations,
    input,
    signal,
    context,
    async (params, client, signal) => {
      const result = parseArcsResponse(
        arcsStatusSchema,
        await client.request(arcsRoutes.complianceJobs, {
          json: {
            jobName: 'MONITOR_RECONCILIATIONS',
            parameters: { periodName: params.periodName, filterName: params.filterName },
          },
          signal,
        })
      )
      const output = {
        status: result.status,
        details: result.details ?? null,
        allClosed: result.status === 0,
      }
      return result.status > 0
        ? { success: false, error: 'Oracle EPM could not monitor reconciliations', output }
        : { success: true, output }
    }
  )
