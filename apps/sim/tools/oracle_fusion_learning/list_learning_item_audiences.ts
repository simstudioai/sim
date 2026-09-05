import {
  credentials,
  internalExecution,
  learningItemId,
  limit,
  offset,
} from '@/tools/oracle_fusion_learning/common'
import {
  type ListLearningItemAudiencesParams,
  type ListLearningItemAudiencesResponse,
  ORACLE_FUSION_LEARNING_LIST_LEARNING_ITEM_AUDIENCES_OUTPUTS,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningListLearningItemAudiencesTool: InternalToolConfig<
  ListLearningItemAudiencesParams,
  ListLearningItemAudiencesResponse
> = {
  id: 'oracle_fusion_learning_list_learning_item_audiences',
  name: 'List Learning Item Audiences',
  description: 'List audience relationships for one learning item.',
  ...internalExecution,
  params: {
    ...credentials,
    ...learningItemId,
    ...limit,
    ...offset,
  },
  outputs: ORACLE_FUSION_LEARNING_LIST_LEARNING_ITEM_AUDIENCES_OUTPUTS,
}
