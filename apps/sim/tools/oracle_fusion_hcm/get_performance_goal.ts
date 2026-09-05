import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_GET_PERFORMANCE_GOAL_OUTPUTS,
  type OracleFusionHcmGetPerformanceGoalParams,
  type OracleFusionHcmGetPerformanceGoalResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmGetPerformanceGoalTool: InternalToolConfig<
  OracleFusionHcmGetPerformanceGoalParams,
  OracleFusionHcmGetPerformanceGoalResponse
> = {
  id: 'oracle_fusion_hcm_get_performance_goal',
  name: 'Get Performance Goal in Oracle Fusion HCM',
  description: 'Read an Oracle Fusion HCM performance goal by its documented ID, subject to tenant data access.',
  ...internalExecution,
  params: {
    ...common,
    goalId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Goal ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_GET_PERFORMANCE_GOAL_OUTPUTS,
}
