import { planningEndpoints, planningLinkPolicies } from '@/lib/internal/oracle-epm-planning/route-space'
import { PlanningContractError, type PlanningOperationContext, parsePlanningResponse, planningUnitStatusSchema } from '@/lib/internal/oracle-epm-planning/schema'
import type { OracleEpmPlanningChangePlanningUnitStatusParams, OracleEpmPlanningResponse } from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/change_planning_unit_status.html */
export async function executeOracleEpmPlanningChangePlanningUnitStatus(
  input: OracleEpmPlanningChangePlanningUnitStatusParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const parsed = parsePlanningResponse(planningUnitStatusSchema,
    await context.client.request(planningEndpoints.changePlanningUnitStatus, {
      pathParams: { application: input.application, puhIdentifier: input.puhIdentifier },
      headers: { contentType: 'application/x-www-form-urlencoded' },
      stream: new TextEncoder().encode(new URLSearchParams({
        actionId: String(input.actionId),
        pmMembers: input.pmMembers,
        comments: input.comments ?? '',
      }).toString()),
      signal: context.signal,
    })
  )
  const confirmations = parsed.links.filter((link) => link.rel === 'self')
  if (confirmations.length !== 1 || !confirmations[0].data) throw new PlanningContractError()
  const confirmation = confirmations[0]
  context.client.validateReturnedLink(planningLinkPolicies.planningUnitStatus, {
    rel: confirmation.rel,
    href: confirmation.href,
    method: confirmation.action,
  })
  return { success: true, output: { planningUnitAction: confirmation.data } }
}
