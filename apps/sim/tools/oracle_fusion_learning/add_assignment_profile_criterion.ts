import {
  body,
  credentials,
  internalExecution,
  profileId,
} from '@/tools/oracle_fusion_learning/common'
import {
  type AddAssignmentProfileCriterionParams,
  type AddAssignmentProfileCriterionResponse,
  ORACLE_FUSION_LEARNING_ADD_ASSIGNMENT_PROFILE_CRITERION_OUTPUTS,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningAddAssignmentProfileCriterionTool: InternalToolConfig<
  AddAssignmentProfileCriterionParams,
  AddAssignmentProfileCriterionResponse
> = {
  id: 'oracle_fusion_learning_add_assignment_profile_criterion',
  name: 'Add Assignment Profile Criterion',
  description:
    'Add a documented selection criterion to an assignment profile using the tenant’s criterion type and source ID.',
  ...internalExecution,
  params: {
    ...credentials,
    ...profileId,
    body: {
      ...body.body,
      description:
        'Required: assignmentProfileCriteriaTypeId. Writable fields: assignmentProfileCriteriaType, assignmentProfileCriteriaTypeId, assignmentProfileCriteriaTypeNumber, reportName. IDs use decimal strings. Omit unchanged fields; null is accepted only for nullable fields. Use tenant-defined lookup codes. Schema: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-learningassignmentprofiles-learningassignmentprofilesuniqid-child-learningassignmentprofilecriteria-post.html',
    },
  },
  outputs: ORACLE_FUSION_LEARNING_ADD_ASSIGNMENT_PROFILE_CRITERION_OUTPUTS,
}
