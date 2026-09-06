import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_GET_DEVELOPMENT_GOAL_OUTPUTS,
  type OracleFusionHcmGetDevelopmentGoalParams,
  type OracleFusionHcmGetDevelopmentGoalResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmGetDevelopmentGoalTool: InternalToolConfig<
  OracleFusionHcmGetDevelopmentGoalParams,
  OracleFusionHcmGetDevelopmentGoalResponse
> = {
  id: 'oracle_fusion_hcm_get_development_goal',
  name: 'Get Development Goal in Oracle Fusion HCM',
  description:
    'Read an Oracle Fusion HCM development goal by its documented ID, subject to tenant data access.',
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
  outputs: ORACLE_FUSION_HCM_GET_DEVELOPMENT_GOAL_OUTPUTS,
}
