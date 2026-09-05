import {
  credentials,
  effectiveDate,
  internalExecution,
  learningItemId,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_GET_SELF_PACED_ITEM_OUTPUTS,
  type GetSelfPacedItemParams,
  type GetSelfPacedItemResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningGetSelfPacedItemTool: InternalToolConfig<
  GetSelfPacedItemParams,
  GetSelfPacedItemResponse
> = {
  id: 'oracle_fusion_learning_get_self_paced_item',
  name: 'Get Self Paced Item',
  description:
    'Read a self-paced catalog item by its learning item ID.',
  ...internalExecution,
  params: {
    ...credentials,
    ...learningItemId,
    ...effectiveDate,
  },
  outputs: ORACLE_FUSION_LEARNING_GET_SELF_PACED_ITEM_OUTPUTS,
}
