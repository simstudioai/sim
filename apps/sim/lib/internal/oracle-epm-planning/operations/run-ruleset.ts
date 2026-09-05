import {
  planningJobResult,
  submitPlanningJob,
  validatePlanningRulePrompts,
} from '@/lib/internal/oracle-epm-planning/jobs'
import { type PlanningOperationContext } from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningResponse,
  OracleEpmPlanningRunRulesetParams,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/ruleset.html */
export async function executeOracleEpmPlanningRunRuleset(
  input: OracleEpmPlanningRunRulesetParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  validatePlanningRulePrompts(input.parameters)
  return planningJobResult(await submitPlanningJob({ ...input, jobType: 'RULESET' }, context))
}
