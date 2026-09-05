import { readPlanningJob } from '@/lib/internal/oracle-epm-planning/jobs'
import { type PlanningOperationContext } from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningGetJobParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/retrieve_job_status.html */
export async function executeOracleEpmPlanningGetJob(
  input: OracleEpmPlanningGetJobParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  return { success: true, output: { job: await readPlanningJob(input, context) } }
}
