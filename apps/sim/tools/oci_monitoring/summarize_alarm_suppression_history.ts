import {
  OCI_SUPPRESSION_HISTORY_OUTPUTS,
  type OciMonitoringResponse,
  type OciMonitoringSummarizeAlarmSuppressionHistoryParams,
} from '@/tools/oci_monitoring/types'
import { OCI_CONNECTION_PARAMS, transformOciMonitoringResponse } from '@/tools/oci_monitoring/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociMonitoringSummarizeAlarmSuppressionHistoryTool: InternalToolConfig<
  OciMonitoringSummarizeAlarmSuppressionHistoryParams,
  OciMonitoringResponse
> = {
  id: 'oci_monitoring_summarize_alarm_suppression_history',
  name: 'OCI Monitoring Get Suppression History',
  description: 'Get alarm-wide and dimension-specific suppression history',
  version: '1.0.0',
  params: {
    ...OCI_CONNECTION_PARAMS,
    alarmId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Alarm OCID.',
    },
    dimensions: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of dimension names and single string values; required for dimension suppression.',
    },
    timeSuppressFromGreaterThanOrEqualTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Inclusive RFC3339 lower bound on suppression start time; cannot be in the future.',
    },
    timeSuppressFromLessThan: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Exclusive RFC3339 upper bound on suppression start time; cannot be in the future.',
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
      dimensions: params.dimensions,
      timeSuppressFromGreaterThanOrEqualTo: params.timeSuppressFromGreaterThanOrEqualTo,
      timeSuppressFromLessThan: params.timeSuppressFromLessThan,
      limit: params.limit,
      page: params.page,
    }),
  },
  transformResponse: transformOciMonitoringResponse,
  outputs: OCI_SUPPRESSION_HISTORY_OUTPUTS,
}
