import { internalExecution, listCommon } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_PERFORMANCE_GOALS_OUTPUTS,
  type OracleFusionHcmListPerformanceGoalsParams,
  type OracleFusionHcmListPerformanceGoalsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListPerformanceGoalsTool: InternalToolConfig<
  OracleFusionHcmListPerformanceGoalsParams,
  OracleFusionHcmListPerformanceGoalsResponse
> = {
  id: 'oracle_fusion_hcm_list_performance_goals',
  name: 'List Performance Goals in Oracle Fusion HCM',
  description:
    'Read one page of performance goals from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    personId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Person ID, as a positive decimal string',
    },
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
  outputs: ORACLE_FUSION_HCM_LIST_PERFORMANCE_GOALS_OUTPUTS,
}
