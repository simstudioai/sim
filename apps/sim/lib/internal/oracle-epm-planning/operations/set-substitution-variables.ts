import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  PlanningContractError,
  type PlanningOperationContext,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningResponse,
  OracleEpmPlanningSetSubstitutionVariablesParams,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/planning_create_or_replace_all_subst_variables_for_app_3.html */
export async function executeOracleEpmPlanningSetSubstitutionVariables(
  input: OracleEpmPlanningSetSubstitutionVariablesParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const response = await context.client.request(planningEndpoints.setVariables, {
    pathParams: { application: input.application },
    json: { items: input.variables },
    signal: context.signal,
  })
  if (response.status !== 204) throw new PlanningContractError()
  return { success: true, output: { updated: true } }
}
