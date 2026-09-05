import {
  OCI_METRIC_DATA_OUTPUTS,
  type OciMonitoringResponse,
  type OciMonitoringSummarizeMetricsDataParams,
} from '@/tools/oci_monitoring/types'
import { OCI_CONNECTION_PARAMS, transformOciMonitoringResponse } from '@/tools/oci_monitoring/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociMonitoringSummarizeMetricsDataTool: InternalToolConfig<
  OciMonitoringSummarizeMetricsDataParams,
  OciMonitoringResponse
> = {
  id: 'oci_monitoring_summarize_metrics_data',
  name: 'OCI Monitoring Query Metrics',
  description: 'Query and aggregate metric time series with MQL',
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
    namespace: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Metric namespace, such as oci_computeagent.',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Oracle MQL expression, such as CpuUtilization[1m].mean(); alarm expressions also require a threshold or absence condition.',
    },
    resourceGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Metric resource group; null matches metrics without a resource group.',
    },
    startTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Inclusive RFC3339 query start. Oracle defaults to three hours before the request.',
    },
    endTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclusive RFC3339 query end. Oracle defaults to request time.',
    },
    resolution: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Aggregation window spacing, no greater than the MQL interval. Queries accept 1m–60m, 1h–24h, or 1d; alarms accept only 1m.',
    },
    compartmentIdInSubtree: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Include child compartments; requires the tenancy OCID and tenancy-level permissions.',
    },
    maxStreams: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Maximum returned metric streams: defaults to 100, up to 2000. Excess results fail without truncation.',
    },
    maxDatapoints: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Maximum total returned datapoints: defaults to 10000, up to 100000. Excess results fail without truncation.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      compartmentId: params.compartmentId,
      namespace: params.namespace,
      query: params.query,
      resourceGroup: params.resourceGroup,
      startTime: params.startTime,
      endTime: params.endTime,
      resolution: params.resolution,
      compartmentIdInSubtree: params.compartmentIdInSubtree,
      maxStreams: params.maxStreams,
      maxDatapoints: params.maxDatapoints,
    }),
  },
  transformResponse: transformOciMonitoringResponse,
  outputs: OCI_METRIC_DATA_OUTPUTS,
}
