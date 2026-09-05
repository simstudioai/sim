import { credentials, internalExecution, profileId } from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_PROCESS_ASSIGNMENT_PROFILE_OUTPUTS,
  type ProcessAssignmentProfileParams,
  type ProcessAssignmentProfileResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningProcessAssignmentProfileTool: InternalToolConfig<
  ProcessAssignmentProfileParams,
  ProcessAssignmentProfileResponse
> = {
  id: 'oracle_fusion_learning_process_assignment_profile',
  name: 'Process Assignment Profile',
  description:
    'Request assignment profile processing. The numeric result is an acknowledgement, not a verified job ID or assignment success count.',
  ...internalExecution,
  params: {
    ...credentials,
    ...profileId,
  },
  outputs: ORACLE_FUSION_LEARNING_PROCESS_ASSIGNMENT_PROFILE_OUTPUTS,
}
