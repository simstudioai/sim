import { internalExecution, listCommon } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_GOAL_PLANS_OUTPUTS,
  type OracleFusionHcmListGoalPlansParams,
  type OracleFusionHcmListGoalPlansResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListGoalPlansTool: InternalToolConfig<
  OracleFusionHcmListGoalPlansParams,
  OracleFusionHcmListGoalPlansResponse
> = {
  id: 'oracle_fusion_hcm_list_goal_plans',
  name: 'List Goal Plans in Oracle Fusion HCM',
  description:
    'Read one page of goal plans from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    reviewPeriodId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Review period ID, as a positive decimal string',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search text (maximum 200 characters)',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_GOAL_PLANS_OUTPUTS,
}
