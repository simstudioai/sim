import { listCommon, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_TIME_RECORD_REQUEST_EVENTS_OUTPUTS,
  type OracleFusionHcmListTimeRecordRequestEventsParams,
  type OracleFusionHcmListTimeRecordRequestEventsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListTimeRecordRequestEventsTool: InternalToolConfig<
  OracleFusionHcmListTimeRecordRequestEventsParams,
  OracleFusionHcmListTimeRecordRequestEventsResponse
> = {
  id: 'oracle_fusion_hcm_list_time_record_request_events',
  name: 'List Time Record Request Events in Oracle Fusion HCM',
  description: 'Read one page of time record request events from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    timeRecordEventRequestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Time record event request ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_TIME_RECORD_REQUEST_EVENTS_OUTPUTS,
}
