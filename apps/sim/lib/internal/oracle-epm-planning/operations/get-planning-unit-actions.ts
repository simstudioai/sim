import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  type PlanningOperationContext,
  parsePlanningResponse,
  planningUnitActionsSchema,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningGetPlanningUnitActionsParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_available_planning_unit_actions.html */
export async function executeOracleEpmPlanningGetPlanningUnitActions(
  input: OracleEpmPlanningGetPlanningUnitActionsParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  // The resource declaration and API catalog specify POST. The example self-link's GET
  // label is inconsistent; it is neither followed nor used to select a fallback method.
  // https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/GUID-185E11F9-8420-414A-B2EA-9098767FC24F.pdf
  const parsed = parsePlanningResponse(
    planningUnitActionsSchema,
    await context.client.request(planningEndpoints.planningUnitActions, {
      pathParams: { application: input.application, puhIdentifier: input.puhIdentifier },
      query: { q: JSON.stringify({ options: input.approvalOptions ?? 1 }) },
      headers: { contentType: 'application/x-www-form-urlencoded' },
      stream: new TextEncoder().encode(
        new URLSearchParams({ pmMembers: input.pmMembers }).toString()
      ),
      signal: context.signal,
    })
  )
  return { success: true, output: { planningUnitActions: parsed.items } }
}
