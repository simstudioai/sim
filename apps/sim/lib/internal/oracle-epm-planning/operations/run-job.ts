import { planningJobResult, submitPlanningJob } from '@/lib/internal/oracle-epm-planning/jobs'
import { type PlanningOperationContext } from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningResponse,
  OracleEpmPlanningRunJobParams,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/execute_a_job.html */
export async function executeOracleEpmPlanningRunJob(
  input: OracleEpmPlanningRunJobParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  return planningJobResult(await submitPlanningJob(input, context))
}
