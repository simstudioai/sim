import {
  OCI_DIMENSION_STATES_OUTPUTS,
  type OciMonitoringResponse,
  type OciMonitoringRetrieveDimensionStatesParams,
} from '@/tools/oci_monitoring/types'
import { OCI_CONNECTION_PARAMS, transformOciMonitoringResponse } from '@/tools/oci_monitoring/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociMonitoringRetrieveDimensionStatesTool: InternalToolConfig<
  OciMonitoringRetrieveDimensionStatesParams,
  OciMonitoringResponse
> = {
  id: 'oci_monitoring_retrieve_dimension_states',
  name: 'OCI Monitoring Get Dimension States',
  description: 'Inspect the status of individual metric streams in an alarm',
  version: '1.0.0',
  params: {
    ...OCI_CONNECTION_PARAMS,
    alarmId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Alarm OCID.',
    },
    dimensionFilters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object matching the exact complete set of dimension names and values for an alarm state entry. Partial dimension sets do not match.',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Alarm status: FIRING or OK.',
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
      dimensionFilters: params.dimensionFilters,
      status: params.status,
      limit: params.limit,
      page: params.page,
    }),
  },
  transformResponse: transformOciMonitoringResponse,
  outputs: OCI_DIMENSION_STATES_OUTPUTS,
}
