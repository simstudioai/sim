import {
  OCI_ALARM_STATUSES_OUTPUTS,
  type OciMonitoringListAlarmsStatusParams,
  type OciMonitoringResponse,
} from '@/tools/oci_monitoring/types'
import { OCI_CONNECTION_PARAMS, transformOciMonitoringResponse } from '@/tools/oci_monitoring/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociMonitoringListAlarmsStatusTool: InternalToolConfig<
  OciMonitoringListAlarmsStatusParams,
  OciMonitoringResponse
> = {
  id: 'oci_monitoring_list_alarms_status',
  name: 'OCI Monitoring List Alarm Statuses',
  description: 'List current aggregate alarm statuses',
  version: '1.0.0',
  params: {
    ...OCI_CONNECTION_PARAMS,
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Compartment OCID. Subtree queries require the tenancy OCID and tenancy-level access.',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Alarm or suppression display name; list operations use exact matching.',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field: displayName or severity.',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: ASC or DESC.',
    },
    resourceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter alarm status by monitored resource OCID.',
    },
    serviceName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by the exact service-name dimension.',
    },
    entityId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by monitored entity OCID.',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Alarm status: FIRING or OK.',
    },
    compartmentIdInSubtree: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Include child compartments; requires the tenancy OCID and tenancy-level permissions.',
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
      compartmentId: params.compartmentId,
      displayName: params.displayName,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
      resourceId: params.resourceId,
      serviceName: params.serviceName,
      entityId: params.entityId,
      status: params.status,
      compartmentIdInSubtree: params.compartmentIdInSubtree,
      limit: params.limit,
      page: params.page,
    }),
  },
  transformResponse: transformOciMonitoringResponse,
  outputs: OCI_ALARM_STATUSES_OUTPUTS,
}
