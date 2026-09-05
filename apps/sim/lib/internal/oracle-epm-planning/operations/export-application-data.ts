import {
  planningJobResult,
  submitPlanningJob,
  validatePlanningJobParameters,
} from '@/lib/internal/oracle-epm-planning/jobs'
import { type PlanningOperationContext } from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningExportApplicationDataParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/export_data.html */
export async function executeOracleEpmPlanningExportApplicationData(
  input: OracleEpmPlanningExportApplicationDataParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const parameters = validatePlanningJobParameters('export', input)
  return planningJobResult(
    await submitPlanningJob(
      {
        application: input.application,
        jobType: 'EXPORT_DATA',
        jobName: input.jobName,
        parameters,
      },
      context
    )
  )
}
