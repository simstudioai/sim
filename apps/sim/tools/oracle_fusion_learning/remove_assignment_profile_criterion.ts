import {
  credentials,
  criterionId,
  internalExecution,
  profileId,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_REMOVE_ASSIGNMENT_PROFILE_CRITERION_OUTPUTS,
  type RemoveAssignmentProfileCriterionParams,
  type RemoveAssignmentProfileCriterionResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningRemoveAssignmentProfileCriterionTool: InternalToolConfig<
  RemoveAssignmentProfileCriterionParams,
  RemoveAssignmentProfileCriterionResponse
> = {
  id: 'oracle_fusion_learning_remove_assignment_profile_criterion',
  name: 'Remove Assignment Profile Criterion',
  description: 'Remove a selection criterion from its assignment profile.',
  ...internalExecution,
  params: {
    ...credentials,
    ...profileId,
    ...criterionId,
  },
  outputs: ORACLE_FUSION_LEARNING_REMOVE_ASSIGNMENT_PROFILE_CRITERION_OUTPUTS,
}
