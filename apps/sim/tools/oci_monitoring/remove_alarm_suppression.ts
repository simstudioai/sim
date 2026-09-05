import {
  OCI_REQUEST_OUTPUTS,
  type OciMonitoringRemoveAlarmSuppressionParams,
  type OciMonitoringResponse,
} from '@/tools/oci_monitoring/types'
import { OCI_CONNECTION_PARAMS, transformOciMonitoringResponse } from '@/tools/oci_monitoring/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociMonitoringRemoveAlarmSuppressionTool: InternalToolConfig<
  OciMonitoringRemoveAlarmSuppressionParams,
  OciMonitoringResponse
> = {
  id: 'oci_monitoring_remove_alarm_suppression',
  name: 'OCI Monitoring Remove Alarm Suppression',
  description: 'Remove the existing suppression attached to an alarm',
  version: '1.0.0',
  params: {
    ...OCI_CONNECTION_PARAMS,
    alarmId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Alarm OCID.',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ETag returned by a previous read; the mutation succeeds only if it still matches.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      alarmId: params.alarmId,
      ifMatch: params.ifMatch,
    }),
  },
  transformResponse: transformOciMonitoringResponse,
  outputs: OCI_REQUEST_OUTPUTS,
}
