import {
  body,
  credentials,
  internalExecution,
  personId,
} from '@/tools/oracle_fusion_learning/common'
import {
  type CreateLearningRecordParams,
  type CreateLearningRecordResponse,
  ORACLE_FUSION_LEARNING_CREATE_LEARNING_RECORD_OUTPUTS,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningCreateLearningRecordTool: InternalToolConfig<
  CreateLearningRecordParams,
  CreateLearningRecordResponse
> = {
  id: 'oracle_fusion_learning_create_learning_record',
  name: 'Create Learning Record',
  description:
    'Enroll or assign a person to a learning item. Oracle may return pending, approval, or waitlist status.',
  ...internalExecution,
  params: {
    ...credentials,
    ...personId,
    body: {
      ...body.body,
      description:
        'Required: learningItemId. Writable fields: learningItemId, learningItemNumber, learningItemType, assignmentType, assignmentStatus, assignmentSubStatus, assignmentDueDate, assignedDate, completedDate, actualScore, actualEffortInHours, actualCpeUnits, assignmentJustification, reasonCode, statusChangeComment, dataSecurityPrivilege. IDs use decimal strings. Omit unchanged fields; null is accepted only for nullable fields. Use tenant-defined lookup codes. Schema: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-learnerlearningrecords-post.html',
    },
  },
  outputs: ORACLE_FUSION_LEARNING_CREATE_LEARNING_RECORD_OUTPUTS,
}
