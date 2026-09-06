import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  jobDetailsSchema,
  type PlanningOperationContext,
  parsePlanningResponse,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningGetJobDetailsParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/retrieve_job_status_details.html */
export async function executeOracleEpmPlanningGetJobDetails(
  input: OracleEpmPlanningGetJobDetailsParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const parsed = parsePlanningResponse(
    jobDetailsSchema,
    await context.client.request(planningEndpoints.jobDetails, {
      pathParams: { application: input.application, jobId: input.jobId },
      query: {
        offset: input.offset ?? 0,
        limit: input.limit ?? 100,
        q: input.messageType ? JSON.stringify({ messageType: input.messageType }) : undefined,
      },
      signal: context.signal,
    })
  )
  return { success: true, output: { jobDetails: parsed.items } }
}
