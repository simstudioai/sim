import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  insightsSchema,
  type PlanningOperationContext,
  parsePlanningResponse,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningGetInsightsParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_insigh.html */
export async function executeOracleEpmPlanningGetInsights(
  input: OracleEpmPlanningGetInsightsParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const parsed = parsePlanningResponse(
    insightsSchema,
    await context.client.request(planningEndpoints.insights, {
      pathParams: { application: input.application },
      json: {
        dataSourceType: 'CUBE',
        location: input.cube,
        slice: input.insightSlice,
        retrievalMode: input.retrievalMode ?? 'USE_EXISTING',
        ...(input.retrievalMode === 'FORCE_RECOMPUTE' ? { calendar: input.calendar } : {}),
      },
      signal: context.signal,
    })
  )
  return {
    success: true,
    output: {
      insights: parsed.items,
      totalResults: parsed.totalResults,
      hasMore: parsed.hasMore,
    },
  }
}
