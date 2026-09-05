import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  memberSchema,
  type PlanningOperationContext,
  parsePlanningResponse,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningAddMemberParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/add_member.html */
export async function executeOracleEpmPlanningAddMember(
  input: OracleEpmPlanningAddMemberParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const member = parsePlanningResponse(
    memberSchema,
    await context.client.request(planningEndpoints.addMember, {
      pathParams: { application: input.application, dimension: input.dimension },
      json: { memberName: input.memberName, parentName: input.parentName },
      signal: context.signal,
    })
  )
  return { success: true, output: { member } }
}
