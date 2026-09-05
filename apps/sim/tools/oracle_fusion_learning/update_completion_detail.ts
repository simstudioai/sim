import {
  body,
  completionDetailId,
  credentials,
  internalExecution,
  personId,
  recordId,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_UPDATE_COMPLETION_DETAIL_OUTPUTS,
  type UpdateCompletionDetailParams,
  type UpdateCompletionDetailResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningUpdateCompletionDetailTool: InternalToolConfig<
  UpdateCompletionDetailParams,
  UpdateCompletionDetailResponse
> = {
  id: 'oracle_fusion_learning_update_completion_detail',
  name: 'Update Completion Detail',
  description:
    'Change a root assignment activity attempt status or completion reason. Activity completion does not imply course completion.',
  ...internalExecution,
  params: {
    ...credentials,
    ...personId,
    ...recordId,
    ...completionDetailId,
    body: {
      ...body.body,
      description:
        'Writable fields: activityAttemptStatus, activityAttemptCompletionReasonCode. IDs use decimal strings. Omit unchanged fields; null is accepted only for nullable fields. Use tenant-defined lookup codes. Schema: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-learnerlearningrecords-learnerlearningrecordsuniqid-child-completiondetails-completiondetailsuniqid-patch.html',
    },
  },
  outputs: ORACLE_FUSION_LEARNING_UPDATE_COMPLETION_DETAIL_OUTPUTS,
}
