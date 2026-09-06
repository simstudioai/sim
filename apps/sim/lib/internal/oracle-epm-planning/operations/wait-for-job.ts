import { waitForPlanningJob } from '@/lib/internal/oracle-epm-planning/jobs'
import type { PlanningOperationContext } from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningResponse,
  OracleEpmPlanningWaitForJobParams,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/retrieve_job_status.html */
export async function executeOracleEpmPlanningWaitForJob(
  input: OracleEpmPlanningWaitForJobParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  return waitForPlanningJob(input, context)
}
