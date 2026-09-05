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
  ORACLE_FUSION_LEARNING_LIST_COMPLETION_DETAILS_OUTPUTS,
  type ListCompletionDetailsParams,
  type ListCompletionDetailsResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningListCompletionDetailsTool: InternalToolConfig<
  ListCompletionDetailsParams,
  ListCompletionDetailsResponse
> = {
  id: 'oracle_fusion_learning_list_completion_details',
  name: 'List Completion Details',
  description:
    'Read activity completion details for an assignment or its selected offering.',
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
  outputs: ORACLE_FUSION_LEARNING_LIST_COMPLETION_DETAILS_OUTPUTS,
}
