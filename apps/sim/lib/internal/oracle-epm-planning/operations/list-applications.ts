import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  applicationsSchema,
  type PlanningOperationContext,
  parsePlanningResponse,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningListApplicationsParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_applications.html */
export async function executeOracleEpmPlanningListApplications(
  _input: OracleEpmPlanningListApplicationsParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const parsed = parsePlanningResponse(
    applicationsSchema,
    await context.client.request(planningEndpoints.applications, {
      signal: context.signal,
    })
  )
  return { success: true, output: { applications: parsed.items } }
}
