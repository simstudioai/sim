import { body, credentials, internalExecution } from '@/tools/oracle_fusion_learning/common'
import {
  type CreateAssignmentProfileParams,
  type CreateAssignmentProfileResponse,
  ORACLE_FUSION_LEARNING_CREATE_ASSIGNMENT_PROFILE_OUTPUTS,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningCreateAssignmentProfileTool: InternalToolConfig<
  CreateAssignmentProfileParams,
  CreateAssignmentProfileResponse
> = {
  id: 'oracle_fusion_learning_create_assignment_profile',
  name: 'Create Assignment Profile',
  description:
    'Create an administrator assignment profile for a learning item. Processing is a separate action.',
  ...internalExecution,
  params: {
    ...credentials,
    body: {
      ...body.body,
      description:
        'Required: assignmentProfileStatus, assignmentType, learningItemId. Writable fields: assignmentProfileNumber, assignmentProfileTitle, assignmentProfileDescription, assignmentProfileStatus, assignmentProfileStartDate, assignmentProfileEndDate, learningItemId, learningItemNumber, learningItemType, assignmentType, assignmentSubType, targetAssignmentStatus, assignmentRecordStatus, assignmentDueDate, assignmentDueDateType, assignmentDueIn, assignmentDueInUnits, processingRule, processingFrequency, assignmentCompletionDate, assignmentActualScore, assignmentActualEffort, completionReasonCode, completionComments, waivePrerequisites, waiveReasonCode, waiveComments, increaseMaximumCapacity, withdrawOnProcessing, excludeEnrollmentFromHistory, enableRenewals, retakeRule, dataSecurityPrivilege. IDs use decimal strings. Omit unchanged fields; null is accepted only for nullable fields. Use tenant-defined lookup codes. Schema: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-learningassignmentprofiles-post.html',
    },
  },
  outputs: ORACLE_FUSION_LEARNING_CREATE_ASSIGNMENT_PROFILE_OUTPUTS,
}
