import {
  body,
  credentials,
  internalExecution,
} from '@/tools/oracle_fusion_learning/common'
import {
  type CreateLearningEventParams,
  type CreateLearningEventResponse,
  ORACLE_FUSION_LEARNING_CREATE_LEARNING_EVENT_OUTPUTS,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningCreateLearningEventTool: InternalToolConfig<
  CreateLearningEventParams,
  CreateLearningEventResponse
> = {
  id: 'oracle_fusion_learning_create_learning_event',
  name: 'Create Learning Event',
  description: 'Create a Learning event draft with catalog visibility and scheduling metadata.',
  ...internalExecution,
  params: {
    ...credentials,
    body: {
      ...body.body,
      description:
        'Required: learningItemNumber, learningItemVisibility. Writable fields: learningItemNumber, learningItemTitle, learningItemType, learningItemStatus, learningItemVisibility, learningItemDescription, learningItemLongDescription, learningItemCatalogProfileId, learningItemCatalogProfileNumber, learningItemPublishStartDate, learningItemPublishEndDate, learningItemEnrollmentStartDate, learningItemEnrollmentEndDate, learningItemStatusComment, eventStartDate, eventEndDate, eventTimezone, eventCapacityEnabled, eventCapacityMaximum, eventCapacityMinimum, eventWaitlistEnabled, eventWaitlistMaximumEnabled, eventWaitlistMaximum, eventCancelDate, eventCancelReasonCode, eventClosedDate, eventClosedReasonCode, eventClosedActivityStatus. IDs use decimal strings. Omit unchanged fields; null is accepted only for nullable fields. Use tenant-defined lookup codes. Schema: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-learningevents-post.html',
    },
  },
  outputs: ORACLE_FUSION_LEARNING_CREATE_LEARNING_EVENT_OUTPUTS,
}
