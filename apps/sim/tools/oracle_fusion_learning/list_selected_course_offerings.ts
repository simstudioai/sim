import {
  assignmentStatus,
  credentials,
  effectiveDate,
  internalExecution,
  limit,
  offset,
  personId,
  recordId,
  search,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_LIST_SELECTED_COURSE_OFFERINGS_OUTPUTS,
  type ListSelectedCourseOfferingsParams,
  type ListSelectedCourseOfferingsResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningListSelectedCourseOfferingsTool: InternalToolConfig<
  ListSelectedCourseOfferingsParams,
  ListSelectedCourseOfferingsResponse
> = {
  id: 'oracle_fusion_learning_list_selected_course_offerings',
  name: 'List Selected Course Offerings',
  description:
    'List offerings selected under one learning assignment. This is not an available-offerings catalog.',
  ...internalExecution,
  params: {
    ...credentials,
    ...personId,
    ...recordId,
    ...limit,
    ...offset,
    ...search,
    ...effectiveDate,
    ...assignmentStatus,
  },
  outputs: ORACLE_FUSION_LEARNING_LIST_SELECTED_COURSE_OFFERINGS_OUTPUTS,
}
