import {
  body,
  credentials,
  internalExecution,
  personId,
  recordId,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_SELECT_COURSE_OFFERING_OUTPUTS,
  type SelectCourseOfferingParams,
  type SelectCourseOfferingResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningSelectCourseOfferingTool: InternalToolConfig<
  SelectCourseOfferingParams,
  SelectCourseOfferingResponse
> = {
  id: 'oracle_fusion_learning_select_course_offering',
  name: 'Select Course Offering',
  description:
    'Select an offering for a person’s course assignment. Enrollment policies may require approval or waitlisting.',
  ...internalExecution,
  params: {
    ...credentials,
    ...personId,
    ...recordId,
    body: {
      ...body.body,
      description:
        'Required: learningItemId. Writable fields: learningItemId, learningItemNumber, learningItemType, assignmentType, assignmentStatus, assignmentDueDate, assignmentJustification, reasonCode, statusChangeComment, dataSecurityPrivilege. IDs use decimal strings. Omit unchanged fields; null is accepted only for nullable fields. Use tenant-defined lookup codes. Schema: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-learnerlearningrecords-learnerlearningrecordsuniqid-child-selectedcourseofferings-post.html',
    },
  },
  outputs: ORACLE_FUSION_LEARNING_SELECT_COURSE_OFFERING_OUTPUTS,
}
