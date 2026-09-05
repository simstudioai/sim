import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import { type PlanningOperationContext, parsePlanningResponse, insightSummarySchema } from '@/lib/internal/oracle-epm-planning/schema'
import type { OracleEpmPlanningSummarizeInsightsParams, OracleEpmPlanningResponse } from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/insigh_summ.html */
export async function executeOracleEpmPlanningSummarizeInsights(
  input: OracleEpmPlanningSummarizeInsightsParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const parsed = parsePlanningResponse(insightSummarySchema,
    await context.client.request(planningEndpoints.insightSummary, {
      pathParams: { application: input.application },
      json: {
        format: 'text',
        size: input.summarySize ?? 100,
        ...(input.summaryInputMode === 'ids'
          ? { ids: input.insightIds }
          : {
              dataSourceType: 'CUBE',
              location: input.cube,
              slice: input.insightSlice,
              retrievalMode: input.retrievalMode ?? 'USE_EXISTING',
              ...(input.retrievalMode === 'FORCE_RECOMPUTE' ? { calendar: input.calendar } : {}),
            }),
      },
      signal: context.signal,
    })
  )
  return { success: true, output: { summary: parsed.summary } }
}
