import {
  credentials,
  effectiveDate,
  eventId,
  internalExecution,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_GET_LEARNING_EVENT_OUTPUTS,
  type GetLearningEventParams,
  type GetLearningEventResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningGetLearningEventTool: InternalToolConfig<
  GetLearningEventParams,
  GetLearningEventResponse
> = {
  id: 'oracle_fusion_learning_get_learning_event',
  name: 'Get Learning Event',
  description:
    'Read Learning event metadata and scheduling fields.',
  ...internalExecution,
  params: {
    ...credentials,
    ...eventId,
    ...effectiveDate,
  },
  outputs: ORACLE_FUSION_LEARNING_GET_LEARNING_EVENT_OUTPUTS,
}
