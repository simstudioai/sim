import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_GET_TIME_RECORD_OUTPUTS,
  type OracleFusionHcmGetTimeRecordParams,
  type OracleFusionHcmGetTimeRecordResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmGetTimeRecordTool: InternalToolConfig<
  OracleFusionHcmGetTimeRecordParams,
  OracleFusionHcmGetTimeRecordResponse
> = {
  id: 'oracle_fusion_hcm_get_time_record',
  name: 'Get Time Record in Oracle Fusion HCM',
  description:
    'Read an Oracle Fusion HCM time record by its documented ID, subject to tenant data access.',
  ...internalExecution,
  params: {
    ...common,
    timeRecordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Time record ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_GET_TIME_RECORD_OUTPUTS,
}
