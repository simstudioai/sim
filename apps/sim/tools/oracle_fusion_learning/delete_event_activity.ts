import {
  activityId,
  credentials,
  eventId,
  internalExecution,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_DELETE_EVENT_ACTIVITY_OUTPUTS,
  type DeleteEventActivityParams,
  type DeleteEventActivityResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningDeleteEventActivityTool: InternalToolConfig<
  DeleteEventActivityParams,
  DeleteEventActivityResponse
> = {
  id: 'oracle_fusion_learning_delete_event_activity',
  name: 'Delete Event Activity',
  description:
    'Delete an event activity when its lifecycle permits deletion.',
  ...internalExecution,
  params: {
    ...credentials,
    ...eventId,
    ...activityId,
  },
  outputs: ORACLE_FUSION_LEARNING_DELETE_EVENT_ACTIVITY_OUTPUTS,
}
