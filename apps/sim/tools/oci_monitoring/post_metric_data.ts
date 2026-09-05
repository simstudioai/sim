import {
  OCI_INGESTION_OUTPUTS,
  type OciMonitoringPostMetricDataParams,
  type OciMonitoringResponse,
} from '@/tools/oci_monitoring/types'
import { OCI_CONNECTION_PARAMS, transformOciMonitoringResponse } from '@/tools/oci_monitoring/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociMonitoringPostMetricDataTool: InternalToolConfig<
  OciMonitoringPostMetricDataParams,
  OciMonitoringResponse
> = {
  id: 'oci_monitoring_post_metric_data',
  name: 'OCI Monitoring Publish Metrics',
  description: 'Publish custom metric datapoints in one bounded request',
  version: '1.0.0',
  params: {
    ...OCI_CONNECTION_PARAMS,
    metricData: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of custom metric records (compartmentId, namespace, name, dimensions, datapoints). Sim allows 50 records and 1 MiB per request. Timestamps must be less than two hours old and less than ten minutes ahead.',
    },
    batchAtomicity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ATOMIC rejects the whole batch on validation failure; NON_ATOMIC permits partial acceptance.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      metricData: params.metricData,
      batchAtomicity: params.batchAtomicity,
    }),
  },
  transformResponse: transformOciMonitoringResponse,
  outputs: OCI_INGESTION_OUTPUTS,
}
