import {
  credentials,
  internalExecution,
  learningItemId,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_DELETE_SELF_PACED_ITEM_OUTPUTS,
  type DeleteSelfPacedItemParams,
  type DeleteSelfPacedItemResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningDeleteSelfPacedItemTool: InternalToolConfig<
  DeleteSelfPacedItemParams,
  DeleteSelfPacedItemResponse
> = {
  id: 'oracle_fusion_learning_delete_self_paced_item',
  name: 'Delete Self Paced Item',
  description:
    'Delete an initial-draft self-paced item. Published items require the documented deactivation lifecycle.',
  ...internalExecution,
  params: {
    ...credentials,
    ...learningItemId,
  },
  outputs: ORACLE_FUSION_LEARNING_DELETE_SELF_PACED_ITEM_OUTPUTS,
}
