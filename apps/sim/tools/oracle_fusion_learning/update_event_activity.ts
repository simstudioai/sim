import {
  activityId,
  body,
  credentials,
  eventId,
  internalExecution,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_UPDATE_EVENT_ACTIVITY_OUTPUTS,
  type UpdateEventActivityParams,
  type UpdateEventActivityResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningUpdateEventActivityTool: InternalToolConfig<
  UpdateEventActivityParams,
  UpdateEventActivityResponse
> = {
  id: 'oracle_fusion_learning_update_event_activity',
  name: 'Update Event Activity',
  description: 'Update an event activity schedule, attendance rules, or classroom metadata.',
  ...internalExecution,
  params: {
    ...credentials,
    ...eventId,
    ...activityId,
    body: {
      ...body.body,
      description:
        'Writable fields: activityNumber, activityType, title, description, status, startDate, endDate, timezone, expectedEffortInSeconds, completionRule, completionType, enableAttendanceProcessing, minimumAttendance, minimumAttendanceUOM, learnerNoMinimumAttendanceStatus, learnerNotAttendStatus, instructors, classrooms, providerType, onlineMeetingType, virtualClassroomURL. IDs use decimal strings. Omit unchanged fields; null is accepted only for nullable fields. Use tenant-defined lookup codes. Schema: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-learningevents-learningeventsuniqid-child-activities-activitiesuniqid-patch.html',
    },
  },
  outputs: ORACLE_FUSION_LEARNING_UPDATE_EVENT_ACTIVITY_OUTPUTS,
}
