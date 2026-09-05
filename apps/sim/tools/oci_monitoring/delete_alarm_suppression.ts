import {
  OCI_REQUEST_OUTPUTS,
  type OciMonitoringDeleteAlarmSuppressionParams,
  type OciMonitoringResponse,
} from '@/tools/oci_monitoring/types'
import { OCI_CONNECTION_PARAMS, transformOciMonitoringResponse } from '@/tools/oci_monitoring/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociMonitoringDeleteAlarmSuppressionTool: InternalToolConfig<
  OciMonitoringDeleteAlarmSuppressionParams,
  OciMonitoringResponse
> = {
  id: 'oci_monitoring_delete_alarm_suppression',
  name: 'OCI Monitoring Delete Alarm Suppression',
  description: 'Delete one alarm suppression resource',
  version: '1.0.0',
  params: {
    ...OCI_CONNECTION_PARAMS,
    alarmSuppressionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Alarm suppression OCID.',
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
      alarmSuppressionId: params.alarmSuppressionId,
      ifMatch: params.ifMatch,
    }),
  },
  transformResponse: transformOciMonitoringResponse,
  outputs: OCI_REQUEST_OUTPUTS,
}
