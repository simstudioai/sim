import {
  contentId,
  credentials,
  internalExecution,
} from '@/tools/oracle_fusion_learning/common'
import {
  type GetContentItemParams,
  type GetContentItemResponse,
  ORACLE_FUSION_LEARNING_GET_CONTENT_ITEM_OUTPUTS,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningGetContentItemTool: InternalToolConfig<
  GetContentItemParams,
  GetContentItemResponse
> = {
  id: 'oracle_fusion_learning_get_content_item',
  name: 'Get Content Item',
  description:
    'Read safe Learning content metadata by content ID. Upload credentials and locations are excluded.',
  ...internalExecution,
  params: {
    ...credentials,
    ...contentId,
  },
  outputs: ORACLE_FUSION_LEARNING_GET_CONTENT_ITEM_OUTPUTS,
}
