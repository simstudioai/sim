import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  type PlanningOperationContext,
  parsePlanningResponse,
  planningUnitsSchema,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningListPlanningUnitsParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/list_all_planning_units.html */
export async function executeOracleEpmPlanningListPlanningUnits(
  input: OracleEpmPlanningListPlanningUnitsParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const parsed = parsePlanningResponse(
    planningUnitsSchema,
    await context.client.request(planningEndpoints.planningUnits, {
      pathParams: { application: input.application },
      query: {
        q: JSON.stringify({ scenario: input.scenario, version: input.planningVersion }),
        offset: input.offset ?? 0,
        limit: input.limit ?? 100,
      },
      headers: { contentType: 'application/x-www-form-urlencoded' },
      stream: new Uint8Array(0),
      signal: context.signal,
    })
  )
  return { success: true, output: { planningUnits: parsed.items } }
}
