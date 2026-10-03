import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  dimensionsSchema,
  type PlanningOperationContext,
  parsePlanningResponse,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningListDimensionsParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_dim_plan_types.html */
export async function executeOracleEpmPlanningListDimensions(
  input: OracleEpmPlanningListDimensionsParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const parsed = parsePlanningResponse(
    dimensionsSchema,
    await context.client.request(planningEndpoints.dimensions, {
      pathParams: { application: input.application, cube: input.cube },
      query: { offset: input.offset ?? 0, limit: input.limit ?? 100 },
      signal: context.signal,
    })
  )
  return {
    success: true,
    output: {
      dimensions: parsed.items,
      totalResults: parsed.totalResults,
      hasMore: parsed.hasMore,
    },
  }
}
