import {
  OCI_ALARM_OUTPUTS,
  type OciMonitoringGetAlarmParams,
  type OciMonitoringResponse,
} from '@/tools/oci_monitoring/types'
import { OCI_CONNECTION_PARAMS, transformOciMonitoringResponse } from '@/tools/oci_monitoring/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociMonitoringGetAlarmTool: InternalToolConfig<
  OciMonitoringGetAlarmParams,
  OciMonitoringResponse
> = {
  id: 'oci_monitoring_get_alarm',
  name: 'OCI Monitoring Get Alarm',
  description: 'Get an alarm configuration and ETag',
  version: '1.0.0',
  params: {
    ...OCI_CONNECTION_PARAMS,
    alarmId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Alarm OCID.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      alarmId: params.alarmId,
    }),
  },
  transformResponse: transformOciMonitoringResponse,
  outputs: OCI_ALARM_OUTPUTS,
}
