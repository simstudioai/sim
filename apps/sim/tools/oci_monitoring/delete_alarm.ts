import {
  OCI_REQUEST_OUTPUTS,
  type OciMonitoringDeleteAlarmParams,
  type OciMonitoringResponse,
} from '@/tools/oci_monitoring/types'
import { OCI_CONNECTION_PARAMS, transformOciMonitoringResponse } from '@/tools/oci_monitoring/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociMonitoringDeleteAlarmTool: InternalToolConfig<
  OciMonitoringDeleteAlarmParams,
  OciMonitoringResponse
> = {
  id: 'oci_monitoring_delete_alarm',
  name: 'OCI Monitoring Delete Alarm',
  description: 'Delete an alarm using an optional ETag',
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
