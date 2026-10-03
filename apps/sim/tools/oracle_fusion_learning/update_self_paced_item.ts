import {
  body,
  credentials,
  internalExecution,
  learningItemId,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_UPDATE_SELF_PACED_ITEM_OUTPUTS,
  type UpdateSelfPacedItemParams,
  type UpdateSelfPacedItemResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningUpdateSelfPacedItemTool: InternalToolConfig<
  UpdateSelfPacedItemParams,
  UpdateSelfPacedItemResponse
> = {
  id: 'oracle_fusion_learning_update_self_paced_item',
  name: 'Update Self Paced Item',
  description:
    'Update documented self-paced metadata or lifecycle fields. Oracle enforces draft and activation rules.',
  ...internalExecution,
  params: {
    ...credentials,
    ...learningItemId,
    body: {
      ...body.body,
      description:
        'Writable fields: learningItemNumber, learningItemTitle, learningItemType, learningItemStatus, learningItemVisibility, learningItemDescription, learningItemLongDescription, learningItemShortDescription, learningItemCatalogProfileId, learningItemCatalogProfileNumber, learningItemExpectedEffortInSeconds, learningItemPublishStartDate, learningItemPublishEndDate, learningItemEnrollmentStartDate, learningItemEnrollmentEndDate, learningItemActiveDate, learningItemInactiveDate, learningItemInactiveReasonCode, learningItemStatusComment, learningItemKeepCompletionsOnDelete, learningItemProvider, learningItemProviderType. IDs use decimal strings. Omit unchanged fields; null is accepted only for nullable fields. Use tenant-defined lookup codes. Schema: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-learningselfpaceditems-learningselfpaceditemsuniqid-patch.html',
    },
  },
  outputs: ORACLE_FUSION_LEARNING_UPDATE_SELF_PACED_ITEM_OUTPUTS,
}
