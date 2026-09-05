import {
  OCI_ALARMS_OUTPUTS,
  type OciMonitoringListAlarmsParams,
  type OciMonitoringResponse,
} from '@/tools/oci_monitoring/types'
import { OCI_CONNECTION_PARAMS, transformOciMonitoringResponse } from '@/tools/oci_monitoring/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociMonitoringListAlarmsTool: InternalToolConfig<
  OciMonitoringListAlarmsParams,
  OciMonitoringResponse
> = {
  id: 'oci_monitoring_list_alarms',
  name: 'OCI Monitoring List Alarms',
  description: 'List alarm definitions in a compartment',
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
    lifecycleState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lifecycle state: ACTIVE, DELETING, or DELETED. Omit for ACTIVE.',
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
      lifecycleState: params.lifecycleState,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
      compartmentIdInSubtree: params.compartmentIdInSubtree,
      limit: params.limit,
      page: params.page,
    }),
  },
  transformResponse: transformOciMonitoringResponse,
  outputs: OCI_ALARMS_OUTPUTS,
}
