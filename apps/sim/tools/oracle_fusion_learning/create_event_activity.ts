import {
  body,
  credentials,
  eventId,
  internalExecution,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_CREATE_EVENT_ACTIVITY_OUTPUTS,
  type CreateEventActivityParams,
  type CreateEventActivityResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningCreateEventActivityTool: InternalToolConfig<
  CreateEventActivityParams,
  CreateEventActivityResponse
> = {
  id: 'oracle_fusion_learning_create_event_activity',
  name: 'Create Event Activity',
  description:
    'Create a scheduled activity within a Learning event.',
  ...internalExecution,
  params: {
    ...credentials,
    ...eventId,
    body: {
      ...body.body,
      description:
        'Required: activityNumber, status. Writable fields: activityNumber, activityType, title, description, status, startDate, endDate, timezone, expectedEffortInSeconds, completionRule, completionType, enableAttendanceProcessing, minimumAttendance, minimumAttendanceUOM, learnerNoMinimumAttendanceStatus, learnerNotAttendStatus, instructors, classrooms, providerType, onlineMeetingType, virtualClassroomURL. IDs use decimal strings. Omit unchanged fields; null is accepted only for nullable fields. Use tenant-defined lookup codes. Schema: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-learningevents-learningeventsuniqid-child-activities-post.html',
    },
  },
  outputs: ORACLE_FUSION_LEARNING_CREATE_EVENT_ACTIVITY_OUTPUTS,
}
