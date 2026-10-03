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
  type ListLearningRecordActionHintsParams,
  type ListLearningRecordActionHintsResponse,
  ORACLE_FUSION_LEARNING_LIST_LEARNING_RECORD_ACTION_HINTS_OUTPUTS,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningListLearningRecordActionHintsTool: InternalToolConfig<
  ListLearningRecordActionHintsParams,
  ListLearningRecordActionHintsResponse
> = {
  id: 'oracle_fusion_learning_list_learning_record_action_hints',
  name: 'List Learning Record Action Hints',
  description:
    'Read Oracle’s permitted-action hints for an assignment or selected offering; hints do not override authorization.',
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
  outputs: ORACLE_FUSION_LEARNING_LIST_LEARNING_RECORD_ACTION_HINTS_OUTPUTS,
}
