import {
  OCI_ALARM_SUPPRESSIONS_OUTPUTS,
  type OciMonitoringListAlarmSuppressionsParams,
  type OciMonitoringResponse,
} from '@/tools/oci_monitoring/types'
import { OCI_CONNECTION_PARAMS, transformOciMonitoringResponse } from '@/tools/oci_monitoring/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociMonitoringListAlarmSuppressionsTool: InternalToolConfig<
  OciMonitoringListAlarmSuppressionsParams,
  OciMonitoringResponse
> = {
  id: 'oci_monitoring_list_alarm_suppressions',
  name: 'OCI Monitoring List Alarm Suppressions',
  description: 'List suppressions affecting an alarm',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Alarm or suppression display name; list operations use exact matching.',
    },
    lifecycleState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lifecycle state: ACTIVE or DELETED. Omit for ACTIVE.',
    },
    level: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ALARM for the whole alarm or DIMENSION for specific metric streams.',
    },
    isAllSuppressions: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include compartment or tenancy suppressions affecting the selected alarm.',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field: displayName, timeCreated, or timeSuppressFrom.',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: ASC or DESC.',
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
      displayName: params.displayName,
      lifecycleState: params.lifecycleState,
      level: params.level,
      isAllSuppressions: params.isAllSuppressions,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
      limit: params.limit,
      page: params.page,
    }),
  },
  transformResponse: transformOciMonitoringResponse,
  outputs: OCI_ALARM_SUPPRESSIONS_OUTPUTS,
}
