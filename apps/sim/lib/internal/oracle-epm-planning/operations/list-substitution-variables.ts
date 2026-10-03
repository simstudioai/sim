import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  PlanningInputError,
  type PlanningOperationContext,
  parsePlanningResponse,
  variablesSchema,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningListSubstitutionVariablesParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/planning_get_all_subst_variables_for_app_1.html */
export async function executeOracleEpmPlanningListSubstitutionVariables(
  input: OracleEpmPlanningListSubstitutionVariablesParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  if (input.derivedValues && !input.cube)
    throw new PlanningInputError('Derived values require a cube')
  const parsed = parsePlanningResponse(
    variablesSchema,
    await context.client.request(
      input.cube ? planningEndpoints.cubeVariables : planningEndpoints.variables,
      {
        pathParams: { application: input.application, ...(input.cube ? { cube: input.cube } : {}) },
        ...(input.cube
          ? { query: { q: JSON.stringify({ derivedValues: input.derivedValues ?? false }) } }
          : {}),
        signal: context.signal,
      }
    )
  )
  return { success: true, output: { variables: parsed.items } }
}
