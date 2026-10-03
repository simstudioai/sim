import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  PlanningContractError,
  type PlanningOperationContext,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningDeleteSubstitutionVariableParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/planning_del_a_subst_variable_for_app.html */
export async function executeOracleEpmPlanningDeleteSubstitutionVariable(
  input: OracleEpmPlanningDeleteSubstitutionVariableParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const response = await context.client.request(
    input.cube ? planningEndpoints.deleteCubeVariable : planningEndpoints.deleteVariable,
    {
      pathParams: {
        application: input.application,
        variableName: input.variableName,
        ...(input.cube ? { cube: input.cube } : {}),
      },
      signal: context.signal,
    }
  )
  if (response.status !== 204) throw new PlanningContractError()
  return { success: true, output: { deleted: true } }
}
