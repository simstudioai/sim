import {
  planningJobResult,
  submitPlanningJob,
  validatePlanningRulePrompts,
} from '@/lib/internal/oracle-epm-planning/jobs'
import { type PlanningOperationContext } from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningResponse,
  OracleEpmPlanningRunRuleParams,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/rules.html */
export async function executeOracleEpmPlanningRunRule(
  input: OracleEpmPlanningRunRuleParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  validatePlanningRulePrompts(input.parameters)
  return planningJobResult(await submitPlanningJob({ ...input, jobType: 'RULES' }, context))
}
