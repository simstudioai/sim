import {
  body,
  credentials,
  internalExecution,
  personId,
  recordId,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_UPDATE_LEARNING_RECORD_OUTPUTS,
  type UpdateLearningRecordParams,
  type UpdateLearningRecordResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningUpdateLearningRecordTool: InternalToolConfig<
  UpdateLearningRecordParams,
  UpdateLearningRecordResponse
> = {
  id: 'oracle_fusion_learning_update_learning_record',
  name: 'Update Learning Record',
  description:
    'Update permitted assignment fields, including completion or withdrawal where the role and lifecycle allow.',
  ...internalExecution,
  params: {
    ...credentials,
    ...personId,
    ...recordId,
    body: {
      ...body.body,
      description:
        'Writable fields: learningItemNumber, assignmentType, assignmentStatus, assignmentSubStatus, assignmentDueDate, assignedDate, completedDate, actualScore, actualEffortInHours, actualCpeUnits, assignmentJustification, reasonCode, statusChangeComment, dataSecurityPrivilege. IDs use decimal strings. Omit unchanged fields; null is accepted only for nullable fields. Use tenant-defined lookup codes. Schema: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-learnerlearningrecords-learnerlearningrecordsuniqid-patch.html',
    },
  },
  outputs: ORACLE_FUSION_LEARNING_UPDATE_LEARNING_RECORD_OUTPUTS,
}
