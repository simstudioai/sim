import { listCommon, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_TIME_RECORD_EVENT_MESSAGES_OUTPUTS,
  type OracleFusionHcmListTimeRecordEventMessagesParams,
  type OracleFusionHcmListTimeRecordEventMessagesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListTimeRecordEventMessagesTool: InternalToolConfig<
  OracleFusionHcmListTimeRecordEventMessagesParams,
  OracleFusionHcmListTimeRecordEventMessagesResponse
> = {
  id: 'oracle_fusion_hcm_list_time_record_event_messages',
  name: 'List Time Record Event Messages in Oracle Fusion HCM',
  description: 'Read one page of time record event messages from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    timeRecordEventRequestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Time record event request ID, as a positive decimal string',
    },
    timeRecordEventId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Time record event ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_TIME_RECORD_EVENT_MESSAGES_OUTPUTS,
}
