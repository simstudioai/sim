import {
  body,
  credentials,
  internalExecution,
} from '@/tools/oracle_fusion_learning/common'
import {
  type CreateSelfPacedItemParams,
  type CreateSelfPacedItemResponse,
  ORACLE_FUSION_LEARNING_CREATE_SELF_PACED_ITEM_OUTPUTS,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningCreateSelfPacedItemTool: InternalToolConfig<
  CreateSelfPacedItemParams,
  CreateSelfPacedItemResponse
> = {
  id: 'oracle_fusion_learning_create_self_paced_item',
  name: 'Create Self Paced Item',
  description: 'Author a self-paced catalog draft. Creation does not publish the item.',
  ...internalExecution,
  params: {
    ...credentials,
    body: {
      ...body.body,
      description:
        'Required: learningItemNumber, learningItemVisibility. Writable fields: learningItemNumber, learningItemTitle, learningItemType, learningItemStatus, learningItemVisibility, learningItemDescription, learningItemLongDescription, learningItemShortDescription, learningItemCatalogProfileId, learningItemCatalogProfileNumber, learningItemExpectedEffortInSeconds, learningItemPublishStartDate, learningItemPublishEndDate, learningItemEnrollmentStartDate, learningItemEnrollmentEndDate, learningItemActiveDate, learningItemInactiveDate, learningItemInactiveReasonCode, learningItemStatusComment, learningItemKeepCompletionsOnDelete, learningItemProvider, learningItemProviderType. IDs use decimal strings. Omit unchanged fields; null is accepted only for nullable fields. Use tenant-defined lookup codes. Schema: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-learningselfpaceditems-post.html',
    },
  },
  outputs: ORACLE_FUSION_LEARNING_CREATE_SELF_PACED_ITEM_OUTPUTS,
}
