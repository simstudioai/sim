import {
  OCI_HISTORY_OUTPUTS,
  type OciMonitoringGetAlarmHistoryParams,
  type OciMonitoringResponse,
} from '@/tools/oci_monitoring/types'
import { OCI_CONNECTION_PARAMS, transformOciMonitoringResponse } from '@/tools/oci_monitoring/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociMonitoringGetAlarmHistoryTool: InternalToolConfig<
  OciMonitoringGetAlarmHistoryParams,
  OciMonitoringResponse
> = {
  id: 'oci_monitoring_get_alarm_history',
  name: 'OCI Monitoring Get Alarm History',
  description: 'Get paginated alarm state and rule history',
  version: '1.0.0',
  params: {
    ...OCI_CONNECTION_PARAMS,
    alarmId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Alarm OCID.',
    },
    alarmHistorytype: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'STATE_HISTORY, STATE_TRANSITION_HISTORY, RULE_HISTORY, or RULE_TRANSITION_HISTORY.',
    },
    timestampGreaterThanOrEqualTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Inclusive RFC3339 lower bound for alarm history.',
    },
    timestampLessThan: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclusive RFC3339 upper bound for alarm history.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum results on this page: 1–1000; defaults to 100.',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque nextPage from the previous response.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      alarmId: params.alarmId,
      alarmHistorytype: params.alarmHistorytype,
      timestampGreaterThanOrEqualTo: params.timestampGreaterThanOrEqualTo,
      timestampLessThan: params.timestampLessThan,
      limit: params.limit,
      page: params.page,
    }),
  },
  transformResponse: transformOciMonitoringResponse,
  outputs: OCI_HISTORY_OUTPUTS,
}
