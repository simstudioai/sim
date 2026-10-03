import {
  body,
  credentials,
  internalExecution,
  offeringRecordId,
  personId,
  recordId,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_UPDATE_SELECTED_COURSE_OFFERING_OUTPUTS,
  type UpdateSelectedCourseOfferingParams,
  type UpdateSelectedCourseOfferingResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningUpdateSelectedCourseOfferingTool: InternalToolConfig<
  UpdateSelectedCourseOfferingParams,
  UpdateSelectedCourseOfferingResponse
> = {
  id: 'oracle_fusion_learning_update_selected_course_offering',
  name: 'Update Selected Course Offering',
  description:
    'Update the documented status, due date, or justification of a selected offering assignment.',
  ...internalExecution,
  params: {
    ...credentials,
    ...personId,
    ...recordId,
    ...offeringRecordId,
    body: {
      ...body.body,
      description:
        'Writable fields: learningItemType, assignmentType, assignmentStatus, assignmentDueDate, assignmentJustification, reasonCode, statusChangeComment, dataSecurityPrivilege. IDs use decimal strings. Omit unchanged fields; null is accepted only for nullable fields. Use tenant-defined lookup codes. Schema: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-learnerlearningrecords-learnerlearningrecordsuniqid-child-selectedcourseofferings-otherselectedcourseofferingsuniqid-patch.html',
    },
  },
  outputs: ORACLE_FUSION_LEARNING_UPDATE_SELECTED_COURSE_OFFERING_OUTPUTS,
}
