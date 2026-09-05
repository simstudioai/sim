import {
  credentials,
  effectiveDate,
  internalExecution,
  limit,
  offeringRecordId,
  offset,
  personId,
  recordId,
} from '@/tools/oracle_fusion_learning/common'
import {
  type ListCompletionSummariesParams,
  type ListCompletionSummariesResponse,
  ORACLE_FUSION_LEARNING_LIST_COMPLETION_SUMMARIES_OUTPUTS,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningListCompletionSummariesTool: InternalToolConfig<
  ListCompletionSummariesParams,
  ListCompletionSummariesResponse
> = {
  id: 'oracle_fusion_learning_list_completion_summaries',
  name: 'List Completion Summaries',
  description:
    'Read Oracle’s completion aggregates for an assignment or selected offering. Progress is not necessarily a percentage.',
  ...internalExecution,
  params: {
    ...credentials,
    ...personId,
    ...recordId,
    ...limit,
    ...offset,
    ...effectiveDate,
    offeringRecordId: { ...offeringRecordId.offeringRecordId, required: false },
  },
  outputs: ORACLE_FUSION_LEARNING_LIST_COMPLETION_SUMMARIES_OUTPUTS,
}
