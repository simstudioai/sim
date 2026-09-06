import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_GET_GOAL_PLAN_OUTPUTS,
  type OracleFusionHcmGetGoalPlanParams,
  type OracleFusionHcmGetGoalPlanResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmGetGoalPlanTool: InternalToolConfig<
  OracleFusionHcmGetGoalPlanParams,
  OracleFusionHcmGetGoalPlanResponse
> = {
  id: 'oracle_fusion_hcm_get_goal_plan',
  name: 'Get Goal Plan in Oracle Fusion HCM',
  description:
    'Read an Oracle Fusion HCM goal plan by its documented ID, subject to tenant data access.',
  ...internalExecution,
  params: {
    ...common,
    goalPlanId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Goal plan ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_GET_GOAL_PLAN_OUTPUTS,
}
