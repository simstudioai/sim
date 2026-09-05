import {
  body,
  credentials,
  internalExecution,
  learningItemId,
} from '@/tools/oracle_fusion_learning/common'
import {
  type AddLearningItemAudienceParams,
  type AddLearningItemAudienceResponse,
  ORACLE_FUSION_LEARNING_ADD_LEARNING_ITEM_AUDIENCE_OUTPUTS,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningAddLearningItemAudienceTool: InternalToolConfig<
  AddLearningItemAudienceParams,
  AddLearningItemAudienceResponse
> = {
  id: 'oracle_fusion_learning_add_learning_item_audience',
  name: 'Add Learning Item Audience',
  description: 'Add a person or learning organization audience relationship to a learning item.',
  ...internalExecution,
  params: {
    ...credentials,
    ...learningItemId,
    body: {
      ...body.body,
      description:
        'Required: sourceType, sourceTypeId, learningItemType. Writable fields: learningItemNumber, learningItemType, sourceType, sourceTypeId, sourceTypeNumber, learnRelationNumber. IDs use decimal strings. Omit unchanged fields; null is accepted only for nullable fields. Use tenant-defined lookup codes. Schema: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-learningitemaudiences-post.html',
    },
  },
  outputs: ORACLE_FUSION_LEARNING_ADD_LEARNING_ITEM_AUDIENCE_OUTPUTS,
}
