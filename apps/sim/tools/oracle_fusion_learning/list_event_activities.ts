import {
  credentials,
  effectiveDate,
  eventId,
  internalExecution,
  limit,
  offset,
  search,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_LIST_EVENT_ACTIVITIES_OUTPUTS,
  type ListEventActivitiesParams,
  type ListEventActivitiesResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningListEventActivitiesTool: InternalToolConfig<
  ListEventActivitiesParams,
  ListEventActivitiesResponse
> = {
  id: 'oracle_fusion_learning_list_event_activities',
  name: 'List Event Activities',
  description:
    'List activities belonging to one Learning event; search uses activity number.',
  ...internalExecution,
  params: {
    ...credentials,
    ...eventId,
    ...limit,
    ...offset,
    ...search,
    ...effectiveDate,
  },
  outputs: ORACLE_FUSION_LEARNING_LIST_EVENT_ACTIVITIES_OUTPUTS,
}
