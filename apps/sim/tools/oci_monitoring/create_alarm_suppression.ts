import {
  OCI_ALARM_SUPPRESSION_OUTPUTS,
  type OciMonitoringCreateAlarmSuppressionParams,
  type OciMonitoringResponse,
} from '@/tools/oci_monitoring/types'
import { OCI_CONNECTION_PARAMS, transformOciMonitoringResponse } from '@/tools/oci_monitoring/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociMonitoringCreateAlarmSuppressionTool: InternalToolConfig<
  OciMonitoringCreateAlarmSuppressionParams,
  OciMonitoringResponse
> = {
  id: 'oci_monitoring_create_alarm_suppression',
  name: 'OCI Monitoring Create Alarm Suppression',
  description: 'Schedule alarm-wide or dimension-specific suppression',
  version: '1.0.0',
  params: {
    ...OCI_CONNECTION_PARAMS,
    alarmId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Alarm OCID.',
    },
    displayName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Alarm or suppression display name; list operations use exact matching.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reason for the suppression.',
    },
    level: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ALARM for the whole alarm or DIMENSION for specific metric streams. Sim defaults new suppressions to ALARM.',
    },
    dimensions: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of dimension names and single string values; required for dimension suppression.',
    },
    timeSuppressFrom: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Inclusive RFC3339 start of suppression.',
    },
    timeSuppressUntil: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Inclusive RFC3339 end of suppression.',
    },
    opcRetryToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Stable retry token for creation. Enables bounded tokenized retries; reuse it for the same logical creation.',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of string tag names and values.',
    },
    definedTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of tag namespaces and values.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      alarmId: params.alarmId,
      displayName: params.displayName,
      description: params.description,
      level: params.level,
      dimensions: params.dimensions,
      timeSuppressFrom: params.timeSuppressFrom,
      timeSuppressUntil: params.timeSuppressUntil,
      opcRetryToken: params.opcRetryToken,
      freeformTags: params.freeformTags,
      definedTags: params.definedTags,
    }),
  },
  transformResponse: transformOciMonitoringResponse,
  outputs: OCI_ALARM_SUPPRESSION_OUTPUTS,
}
