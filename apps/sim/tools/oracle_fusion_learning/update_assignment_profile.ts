import {
  body,
  credentials,
  internalExecution,
  profileId,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_UPDATE_ASSIGNMENT_PROFILE_OUTPUTS,
  type UpdateAssignmentProfileParams,
  type UpdateAssignmentProfileResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningUpdateAssignmentProfileTool: InternalToolConfig<
  UpdateAssignmentProfileParams,
  UpdateAssignmentProfileResponse
> = {
  id: 'oracle_fusion_learning_update_assignment_profile',
  name: 'Update Assignment Profile',
  description: 'Update assignment profile scheduling, completion, renewal, or processing rules.',
  ...internalExecution,
  params: {
    ...credentials,
    ...profileId,
    body: {
      ...body.body,
      description:
        'Writable fields: assignmentProfileTitle, assignmentProfileDescription, assignmentProfileStatus, assignmentProfileStartDate, assignmentProfileEndDate, learningItemNumber, learningItemType, assignmentType, assignmentSubType, targetAssignmentStatus, assignmentRecordStatus, assignmentDueDate, assignmentDueDateType, assignmentDueIn, assignmentDueInUnits, processingRule, processingFrequency, assignmentCompletionDate, assignmentActualScore, assignmentActualEffort, completionReasonCode, completionComments, waivePrerequisites, waiveReasonCode, waiveComments, increaseMaximumCapacity, withdrawOnProcessing, excludeEnrollmentFromHistory, enableRenewals, retakeRule, dataSecurityPrivilege. IDs use decimal strings. Omit unchanged fields; null is accepted only for nullable fields. Use tenant-defined lookup codes. Schema: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-learningassignmentprofiles-learningassignmentprofilesuniqid-patch.html',
    },
  },
  outputs: ORACLE_FUSION_LEARNING_UPDATE_ASSIGNMENT_PROFILE_OUTPUTS,
}
