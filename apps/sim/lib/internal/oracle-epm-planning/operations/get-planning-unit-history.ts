import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import { type PlanningOperationContext, parsePlanningResponse, planningUnitHistorySchema } from '@/lib/internal/oracle-epm-planning/schema'
import type { OracleEpmPlanningGetPlanningUnitHistoryParams, OracleEpmPlanningResponse } from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_planning_unit_history_and_annotations.html */
export async function executeOracleEpmPlanningGetPlanningUnitHistory(
  input: OracleEpmPlanningGetPlanningUnitHistoryParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const parsed = parsePlanningResponse(planningUnitHistorySchema,
    await context.client.request(planningEndpoints.planningUnitHistory, {
      pathParams: { application: input.application, puIdentifier: input.puIdentifier },
      query: {
        q: JSON.stringify({ annotSeq: input.annotSeq ?? -1, logSeq: input.logSeq ?? -1 }),
        offset: input.offset ?? 0,
        limit: input.limit ?? 100,
      },
      signal: context.signal,
    })
  )
  return { success: true, output: { planningUnitHistory: parsed.items } }
}
