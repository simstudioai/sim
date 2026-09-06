import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  clearResultSchema,
  PlanningInputError,
  type PlanningOperationContext,
  parsePlanningResponse,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningClearDataSliceParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/clear_dataslices.html */
export async function executeOracleEpmPlanningClearDataSlice(
  input: OracleEpmPlanningClearDataSliceParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  if (input.clearEssbaseData === false && !input.clearPlanningData)
    throw new PlanningInputError('Select Essbase data and/or Planning details to clear')
  const clearResult = parsePlanningResponse(
    clearResultSchema,
    await context.client.request(planningEndpoints.clearSlice, {
      pathParams: { application: input.application, cube: input.cube },
      json: {
        gridDefinition: input.gridDefinition,
        clearEssbaseData: input.clearEssbaseData ?? true,
        clearPlanningData: input.clearPlanningData ?? false,
      },
      signal: context.signal,
    })
  )
  return { success: true, output: { clearResult } }
}
