import {
  credentials,
  effectiveDate,
  internalExecution,
  limit,
  offset,
  search,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_LIST_ASSIGNMENT_PROFILES_OUTPUTS,
  type ListAssignmentProfilesParams,
  type ListAssignmentProfilesResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningListAssignmentProfilesTool: InternalToolConfig<
  ListAssignmentProfilesParams,
  ListAssignmentProfilesResponse
> = {
  id: 'oracle_fusion_learning_list_assignment_profiles',
  name: 'List Assignment Profiles',
  description:
    'List or search administrator assignment profiles within the credential owner’s data access.',
  ...internalExecution,
  params: {
    ...credentials,
    ...limit,
    ...offset,
    ...search,
    ...effectiveDate,
  },
  outputs: ORACLE_FUSION_LEARNING_LIST_ASSIGNMENT_PROFILES_OUTPUTS,
}
