import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import { PlanningContractError, type PlanningOperationContext } from '@/lib/internal/oracle-epm-planning/schema'
import type { OracleEpmPlanningSetUserVariableValuesParams, OracleEpmPlanningResponse } from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/planning_set_user_variables.html */
export async function executeOracleEpmPlanningSetUserVariableValues(
  input: OracleEpmPlanningSetUserVariableValuesParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  // The API catalog corroborates /uservariablevalues; the example URL says /uservariables.
  // https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/GUID-185E11F9-8420-414A-B2EA-9098767FC24F.pdf
  const response = await context.client.request(planningEndpoints.setUserVariableValues, {
    pathParams: { application: input.application },
    json: { items: input.userVariableValues },
    signal: context.signal,
  })
  if (response.status !== 204) throw new PlanningContractError()
  return { success: true, output: { updated: true } }
}
