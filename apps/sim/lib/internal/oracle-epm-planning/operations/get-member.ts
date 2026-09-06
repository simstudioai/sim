import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  memberSchema,
  type PlanningOperationContext,
  parsePlanningResponse,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningGetMemberParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_member.html */
export async function executeOracleEpmPlanningGetMember(
  input: OracleEpmPlanningGetMemberParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const member = parsePlanningResponse(
    memberSchema,
    await context.client.request(planningEndpoints.member, {
      pathParams: {
        application: input.application,
        dimension: input.dimension,
        memberName: input.memberName,
      },
      signal: context.signal,
    })
  )
  return { success: true, output: { member } }
}
