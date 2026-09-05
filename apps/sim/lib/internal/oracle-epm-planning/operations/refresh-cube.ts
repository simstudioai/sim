import {
  planningJobResult,
  submitPlanningJob,
  validatePlanningJobParameters,
} from '@/lib/internal/oracle-epm-planning/jobs'
import { type PlanningOperationContext } from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningRefreshCubeParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/cube_refresh.html */
export async function executeOracleEpmPlanningRefreshCube(
  input: OracleEpmPlanningRefreshCubeParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const parameters = validatePlanningJobParameters('refresh', input)
  return planningJobResult(
    await submitPlanningJob(
      {
        application: input.application,
        jobType: 'CUBE_REFRESH',
        jobName: input.jobName,
        parameters,
      },
      context
    )
  )
}
