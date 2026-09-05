import {
  OCI_METRICS_OUTPUTS,
  type OciMonitoringListMetricsParams,
  type OciMonitoringResponse,
} from '@/tools/oci_monitoring/types'
import { OCI_CONNECTION_PARAMS, transformOciMonitoringResponse } from '@/tools/oci_monitoring/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociMonitoringListMetricsTool: InternalToolConfig<
  OciMonitoringListMetricsParams,
  OciMonitoringResponse
> = {
  id: 'oci_monitoring_list_metrics',
  name: 'OCI Monitoring List Metrics',
  description: 'Discover metric definitions and namespaces',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Metric namespace, such as oci_computeagent.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact metric name to discover.',
    },
    resourceGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Metric resource group; null matches metrics without a resource group.',
    },
    dimensionFilters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of dimension names and exact string values. Metric discovery ignores this when groupBy is supplied.',
    },
    groupBy: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of namespace, name, or resourceGroup. When present, dimensionFilters is ignored.',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field: NAMESPACE, NAME, or RESOURCEGROUP.',
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
      namespace: params.namespace,
      name: params.name,
      resourceGroup: params.resourceGroup,
      dimensionFilters: params.dimensionFilters,
      groupBy: params.groupBy,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
      compartmentIdInSubtree: params.compartmentIdInSubtree,
      limit: params.limit,
      page: params.page,
    }),
  },
  transformResponse: transformOciMonitoringResponse,
  outputs: OCI_METRICS_OUTPUTS,
}
