import {
  credentials,
  effectiveDate,
  internalExecution,
  limit,
  offset,
  search,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_LIST_LEARNING_EVENTS_OUTPUTS,
  type ListLearningEventsParams,
  type ListLearningEventsResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningListLearningEventsTool: InternalToolConfig<
  ListLearningEventsParams,
  ListLearningEventsResponse
> = {
  id: 'oracle_fusion_learning_list_learning_events',
  name: 'List Learning Events',
  description:
    'List or search Learning events. Requires the event API and unified catalog to be enabled.',
  ...internalExecution,
  params: {
    ...credentials,
    ...limit,
    ...offset,
    ...search,
    ...effectiveDate,
  },
  outputs: ORACLE_FUSION_LEARNING_LIST_LEARNING_EVENTS_OUTPUTS,
}
