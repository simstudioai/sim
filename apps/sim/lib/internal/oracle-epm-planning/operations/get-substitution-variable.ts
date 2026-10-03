import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  PlanningInputError,
  type PlanningOperationContext,
  parsePlanningResponse,
  variableSchema,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningGetSubstitutionVariableParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/planning_get_a_subst_variable_for_app_2.html */
export async function executeOracleEpmPlanningGetSubstitutionVariable(
  input: OracleEpmPlanningGetSubstitutionVariableParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  if (input.derivedValues && !input.cube)
    throw new PlanningInputError('Derived values require a cube')
  const parsed = parsePlanningResponse(
    variableSchema,
    await context.client.request(
      input.cube ? planningEndpoints.cubeVariable : planningEndpoints.variable,
      {
        pathParams: {
          application: input.application,
          variableName: input.variableName,
          ...(input.cube ? { cube: input.cube } : {}),
        },
        ...(input.cube
          ? { query: { q: JSON.stringify({ derivedValues: input.derivedValues ?? false }) } }
          : {}),
        signal: context.signal,
      }
    )
  )
  return { success: true, output: { variable: parsed } }
}
