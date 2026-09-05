import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import { type PlanningOperationContext, parsePlanningResponse, userVariableValuesSchema } from '@/lib/internal/oracle-epm-planning/schema'
import type { OracleEpmPlanningListUserVariableValuesParams, OracleEpmPlanningResponse } from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/planning_get_user_variables_for_app.html */
export async function executeOracleEpmPlanningListUserVariableValues(
  input: OracleEpmPlanningListUserVariableValuesParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const parsed = parsePlanningResponse(userVariableValuesSchema,
    await context.client.request(planningEndpoints.userVariableValues, {
      pathParams: { application: input.application },
      query: { offset: input.offset ?? 0, limit: input.limit ?? 100 },
      signal: context.signal,
    })
  )
  return { success: true, output: { userVariableValues: parsed.items } }
}
