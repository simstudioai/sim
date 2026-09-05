import {
  OCI_ALARM_SUPPRESSION_OUTPUTS,
  type OciMonitoringGetAlarmSuppressionParams,
  type OciMonitoringResponse,
} from '@/tools/oci_monitoring/types'
import { OCI_CONNECTION_PARAMS, transformOciMonitoringResponse } from '@/tools/oci_monitoring/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociMonitoringGetAlarmSuppressionTool: InternalToolConfig<
  OciMonitoringGetAlarmSuppressionParams,
  OciMonitoringResponse
> = {
  id: 'oci_monitoring_get_alarm_suppression',
  name: 'OCI Monitoring Get Alarm Suppression',
  description: 'Get a suppression configuration and ETag',
  version: '1.0.0',
  params: {
    ...OCI_CONNECTION_PARAMS,
    alarmSuppressionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Alarm suppression OCID.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      alarmSuppressionId: params.alarmSuppressionId,
    }),
  },
  transformResponse: transformOciMonitoringResponse,
  outputs: OCI_ALARM_SUPPRESSION_OUTPUTS,
}
