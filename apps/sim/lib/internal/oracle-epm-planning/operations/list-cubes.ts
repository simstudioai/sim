import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  cubesSchema,
  type PlanningOperationContext,
  parsePlanningResponse,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningListCubesParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_plan_types.html */
export async function executeOracleEpmPlanningListCubes(
  input: OracleEpmPlanningListCubesParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const parsed = parsePlanningResponse(
    cubesSchema,
    await context.client.request(planningEndpoints.cubes, {
      pathParams: { application: input.application },
      signal: context.signal,
    })
  )
  return { success: true, output: { cubes: parsed.items } }
}
