import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  dataGridSchema,
  type PlanningOperationContext,
  parsePlanningResponse,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningExportDataSliceParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/export_dataslices.html */
export async function executeOracleEpmPlanningExportDataSlice(
  input: OracleEpmPlanningExportDataSliceParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const dataGrid = parsePlanningResponse(
    dataGridSchema,
    await context.client.request(planningEndpoints.exportSlice, {
      pathParams: { application: input.application, cube: input.cube },
      json: { exportPlanningData: false, gridDefinition: input.gridDefinition },
      signal: context.signal,
    })
  )
  return { success: true, output: { dataGrid } }
}
