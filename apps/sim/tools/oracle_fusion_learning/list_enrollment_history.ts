import {
  credentials,
  effectiveDate,
  internalExecution,
  limit,
  offeringRecordId,
  offset,
  personId,
  recordId,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_LIST_ENROLLMENT_HISTORY_OUTPUTS,
  type ListEnrollmentHistoryParams,
  type ListEnrollmentHistoryResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningListEnrollmentHistoryTool: InternalToolConfig<
  ListEnrollmentHistoryParams,
  ListEnrollmentHistoryResponse
> = {
  id: 'oracle_fusion_learning_list_enrollment_history',
  name: 'List Enrollment History',
  description:
    'Read ordered enrollment status messages for an assignment or selected offering.',
  ...internalExecution,
  params: {
    ...credentials,
    ...personId,
    ...recordId,
    ...limit,
    ...offset,
    ...effectiveDate,
    offeringRecordId: { ...offeringRecordId.offeringRecordId, required: false },
  },
  outputs: ORACLE_FUSION_LEARNING_LIST_ENROLLMENT_HISTORY_OUTPUTS,
}
