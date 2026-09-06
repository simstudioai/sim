import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  jobDefinitionsSchema,
  type PlanningOperationContext,
  parsePlanningResponse,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningListJobDefinitionsParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_job_definitions.html */
export async function executeOracleEpmPlanningListJobDefinitions(
  input: OracleEpmPlanningListJobDefinitionsParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const parsed = parsePlanningResponse(
    jobDefinitionsSchema,
    await context.client.request(planningEndpoints.jobDefinitions, {
      pathParams: { application: input.application },
      query: { q: input.jobType ? JSON.stringify({ jobType: input.jobType }) : undefined },
      signal: context.signal,
    })
  )
  return { success: true, output: { jobDefinitions: parsed.items } }
}
