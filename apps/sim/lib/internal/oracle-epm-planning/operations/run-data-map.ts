import { planningJobResult, submitPlanningJob } from '@/lib/internal/oracle-epm-planning/jobs'
import type { PlanningOperationContext } from '@/lib/internal/oracle-epm-planning/schema'
import type { OracleEpmPlanningRunDataMapParams, OracleEpmPlanningResponse } from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/plan_type_map.html */
export async function executeOracleEpmPlanningRunDataMap(
  input: OracleEpmPlanningRunDataMapParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  return planningJobResult(await submitPlanningJob({
    application: input.application,
    jobType: 'PLAN_TYPE_MAP',
    jobName: input.jobName,
    parameters: {
      clearData: input.clearData,
      ...(input.overrideMembersMap === undefined ? {} : { overrideMembersMap: input.overrideMembersMap }),
      ...(input.overrideExclusionMembersMap === undefined ? {} : { overrideExclusionMembersMap: input.overrideExclusionMembersMap }),
    },
  }, context))
}
