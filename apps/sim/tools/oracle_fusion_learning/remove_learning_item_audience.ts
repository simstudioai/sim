import {
  audienceId,
  credentials,
  internalExecution,
  learningItemId,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_REMOVE_LEARNING_ITEM_AUDIENCE_OUTPUTS,
  type RemoveLearningItemAudienceParams,
  type RemoveLearningItemAudienceResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningRemoveLearningItemAudienceTool: InternalToolConfig<
  RemoveLearningItemAudienceParams,
  RemoveLearningItemAudienceResponse
> = {
  id: 'oracle_fusion_learning_remove_learning_item_audience',
  name: 'Remove Learning Item Audience',
  description: 'Remove an audience relationship from its learning item.',
  ...internalExecution,
  params: {
    ...credentials,
    ...learningItemId,
    ...audienceId,
  },
  outputs: ORACLE_FUSION_LEARNING_REMOVE_LEARNING_ITEM_AUDIENCE_OUTPUTS,
}
