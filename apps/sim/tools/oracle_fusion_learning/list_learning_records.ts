import {
  assignmentStatus,
  credentials,
  effectiveDate,
  internalExecution,
  learningItemId,
  limit,
  offset,
  personId,
  search,
} from '@/tools/oracle_fusion_learning/common'
import {
  type ListLearningRecordsParams,
  type ListLearningRecordsResponse,
  ORACLE_FUSION_LEARNING_LIST_LEARNING_RECORDS_OUTPUTS,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningListLearningRecordsTool: InternalToolConfig<
  ListLearningRecordsParams,
  ListLearningRecordsResponse
> = {
  id: 'oracle_fusion_learning_list_learning_records',
  name: 'List Learning Records',
  description:
    'List learning assignments for one person within the credential owner’s learner or manager data access.',
  ...internalExecution,
  params: {
    ...credentials,
    ...personId,
    ...limit,
    ...offset,
    ...search,
    ...effectiveDate,
    ...assignmentStatus,
    learningItemId: { ...learningItemId.learningItemId, required: false },
  },
  outputs: ORACLE_FUSION_LEARNING_LIST_LEARNING_RECORDS_OUTPUTS,
}
