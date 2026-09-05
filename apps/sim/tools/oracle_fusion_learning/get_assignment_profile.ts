import {
  credentials,
  effectiveDate,
  internalExecution,
  profileId,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_GET_ASSIGNMENT_PROFILE_OUTPUTS,
  type GetAssignmentProfileParams,
  type GetAssignmentProfileResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningGetAssignmentProfileTool: InternalToolConfig<
  GetAssignmentProfileParams,
  GetAssignmentProfileResponse
> = {
  id: 'oracle_fusion_learning_get_assignment_profile',
  name: 'Get Assignment Profile',
  description:
    'Read an assignment profile and its processing settings.',
  ...internalExecution,
  params: {
    ...credentials,
    ...profileId,
    ...effectiveDate,
  },
  outputs: ORACLE_FUSION_LEARNING_GET_ASSIGNMENT_PROFILE_OUTPUTS,
}
