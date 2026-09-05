import {
  credentials,
  effectiveDate,
  internalExecution,
  limit,
  offset,
  profileId,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_LIST_ASSIGNMENT_PROFILE_RECORDS_OUTPUTS,
  type ListAssignmentProfileRecordsParams,
  type ListAssignmentProfileRecordsResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningListAssignmentProfileRecordsTool: InternalToolConfig<
  ListAssignmentProfileRecordsParams,
  ListAssignmentProfileRecordsResponse
> = {
  id: 'oracle_fusion_learning_list_assignment_profile_records',
  name: 'List Assignment Profile Records',
  description:
    'Read assignment results and processing statuses belonging to one assignment profile.',
  ...internalExecution,
  params: {
    ...credentials,
    ...profileId,
    ...limit,
    ...offset,
    ...effectiveDate,
  },
  outputs: ORACLE_FUSION_LEARNING_LIST_ASSIGNMENT_PROFILE_RECORDS_OUTPUTS,
}
