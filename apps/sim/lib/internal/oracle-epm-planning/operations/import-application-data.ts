import {
  planningJobResult,
  submitPlanningJob,
  validatePlanningJobParameters,
} from '@/lib/internal/oracle-epm-planning/jobs'
import type { PlanningOperationContext } from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningImportApplicationDataParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/import_data.html */
export async function executeOracleEpmPlanningImportApplicationData(
  input: OracleEpmPlanningImportApplicationDataParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const parameters = validatePlanningJobParameters('import', input)
  return planningJobResult(
    await submitPlanningJob(
      {
        application: input.application,
        jobType: 'IMPORT_DATA',
        jobName: input.jobName,
        parameters,
      },
      context
    )
  )
}
