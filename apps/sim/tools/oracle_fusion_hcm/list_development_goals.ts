import { internalExecution, listCommon } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_DEVELOPMENT_GOALS_OUTPUTS,
  type OracleFusionHcmListDevelopmentGoalsParams,
  type OracleFusionHcmListDevelopmentGoalsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListDevelopmentGoalsTool: InternalToolConfig<
  OracleFusionHcmListDevelopmentGoalsParams,
  OracleFusionHcmListDevelopmentGoalsResponse
> = {
  id: 'oracle_fusion_hcm_list_development_goals',
  name: 'List Development Goals in Oracle Fusion HCM',
  description:
    'Read one page of development goals from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    personId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Person ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_DEVELOPMENT_GOALS_OUTPUTS,
}
