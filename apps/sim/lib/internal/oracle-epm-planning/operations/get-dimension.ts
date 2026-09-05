import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  dimensionSchema,
  type PlanningOperationContext,
  parsePlanningResponse,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningGetDimensionParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_dim_details.html */
export async function executeOracleEpmPlanningGetDimension(
  input: OracleEpmPlanningGetDimensionParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const dimension = parsePlanningResponse(
    dimensionSchema,
    await context.client.request(planningEndpoints.dimension, {
      pathParams: { application: input.application, cube: input.cube, dimension: input.dimension },
      query: { aliasTableName: input.aliasTableName },
      signal: context.signal,
    })
  )
  return { success: true, output: { dimension } }
}
