import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  importResultSchema,
  type PlanningOperationContext,
  parsePlanningResponse,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningImportDataSliceParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/import_dataslices.html */
export async function executeOracleEpmPlanningImportDataSlice(
  input: OracleEpmPlanningImportDataSliceParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const importResult = parsePlanningResponse(
    importResultSchema,
    await context.client.request(planningEndpoints.importSlice, {
      pathParams: { application: input.application, cube: input.cube },
      json: {
        ...input.importOptions,
        dataGrid: input.dataGrid,
        customParams: { IncludeRejectedCells: true, IncludeRejectedCellsWithDetails: true },
      },
      signal: context.signal,
    })
  )
  return { success: true, output: { importResult } }
}
