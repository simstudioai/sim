import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_GET_TIME_RECORD_REQUEST_OUTPUTS,
  type OracleFusionHcmGetTimeRecordRequestParams,
  type OracleFusionHcmGetTimeRecordRequestResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmGetTimeRecordRequestTool: InternalToolConfig<
  OracleFusionHcmGetTimeRecordRequestParams,
  OracleFusionHcmGetTimeRecordRequestResponse
> = {
  id: 'oracle_fusion_hcm_get_time_record_request',
  name: 'Get Time Record Request in Oracle Fusion HCM',
  description: 'Read an Oracle Fusion HCM time record request by its documented ID, subject to tenant data access.',
  ...internalExecution,
  params: {
    ...common,
    timeRecordEventRequestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Time record event request ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_GET_TIME_RECORD_REQUEST_OUTPUTS,
}
