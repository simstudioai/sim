import {
  body,
  credentials,
  eventId,
  internalExecution,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_UPDATE_LEARNING_EVENT_OUTPUTS,
  type UpdateLearningEventParams,
  type UpdateLearningEventResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningUpdateLearningEventTool: InternalToolConfig<
  UpdateLearningEventParams,
  UpdateLearningEventResponse
> = {
  id: 'oracle_fusion_learning_update_learning_event',
  name: 'Update Learning Event',
  description:
    'Update event metadata, capacity, scheduling, or documented cancellation and closure fields.',
  ...internalExecution,
  params: {
    ...credentials,
    ...eventId,
    body: {
      ...body.body,
      description:
        'Writable fields: learningItemNumber, learningItemTitle, learningItemType, learningItemStatus, learningItemVisibility, learningItemDescription, learningItemLongDescription, learningItemCatalogProfileId, learningItemCatalogProfileNumber, learningItemPublishStartDate, learningItemPublishEndDate, learningItemEnrollmentStartDate, learningItemEnrollmentEndDate, learningItemStatusComment, eventStartDate, eventEndDate, eventTimezone, eventCapacityEnabled, eventCapacityMaximum, eventCapacityMinimum, eventWaitlistEnabled, eventWaitlistMaximumEnabled, eventWaitlistMaximum, eventCancelDate, eventCancelReasonCode, eventClosedDate, eventClosedReasonCode, eventClosedActivityStatus. IDs use decimal strings. Omit unchanged fields; null is accepted only for nullable fields. Use tenant-defined lookup codes. Schema: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-learningevents-learningeventsuniqid-patch.html',
    },
  },
  outputs: ORACLE_FUSION_LEARNING_UPDATE_LEARNING_EVENT_OUTPUTS,
}
