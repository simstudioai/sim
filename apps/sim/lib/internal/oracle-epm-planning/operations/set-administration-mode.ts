import { planningJobResult, submitPlanningJob } from '@/lib/internal/oracle-epm-planning/jobs'
import type { PlanningOperationContext } from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningResponse,
  OracleEpmPlanningSetAdministrationModeParams,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/pbcs_admin_job.html */
export async function executeOracleEpmPlanningSetAdministrationMode(
  input: OracleEpmPlanningSetAdministrationModeParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  return planningJobResult(
    await submitPlanningJob(
      {
        application: input.application,
        jobType: 'Administration Mode',
        jobName: input.jobName,
        parameters: { loginLevel: input.loginLevel },
      },
      context
    )
  )
}
