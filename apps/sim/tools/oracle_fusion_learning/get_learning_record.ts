import {
  credentials,
  effectiveDate,
  internalExecution,
  personId,
  recordId,
} from '@/tools/oracle_fusion_learning/common'
import {
  ORACLE_FUSION_LEARNING_GET_LEARNING_RECORD_OUTPUTS,
  type GetLearningRecordParams,
  type GetLearningRecordResponse,
} from '@/tools/oracle_fusion_learning/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionLearningGetLearningRecordTool: InternalToolConfig<
  GetLearningRecordParams,
  GetLearningRecordResponse
> = {
  id: 'oracle_fusion_learning_get_learning_record',
  name: 'Get Learning Record',
  description:
    'Read one person’s learning assignment, including Oracle’s existing completion state.',
  ...internalExecution,
  params: {
    ...credentials,
    ...personId,
    ...recordId,
    ...effectiveDate,
  },
  outputs: ORACLE_FUSION_LEARNING_GET_LEARNING_RECORD_OUTPUTS,
}
