import {
  credentials,
  effectiveDate,
  internalExecution,
  limit,
  offset,
  profileId,
} from '@/tools/oracle_fusion_learning/common'
import {
  type ListAssignmentProfileCriteriaParams,
  type ListAssignmentProfileCriteriaResponse,
  ORACLE_FUSION_LEARNING_LIST_ASSIGNMENT_PROFILE_CRITERIA_OUTPUTS,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningListAssignmentProfileCriteriaTool: InternalToolConfig<
  ListAssignmentProfileCriteriaParams,
  ListAssignmentProfileCriteriaResponse
> = {
  id: 'oracle_fusion_learning_list_assignment_profile_criteria',
  name: 'List Assignment Profile Criteria',
  description: 'List selection criteria belonging to an assignment profile.',
  ...internalExecution,
  params: {
    ...credentials,
    ...profileId,
    ...limit,
    ...offset,
    ...effectiveDate,
  },
  outputs: ORACLE_FUSION_LEARNING_LIST_ASSIGNMENT_PROFILE_CRITERIA_OUTPUTS,
}
