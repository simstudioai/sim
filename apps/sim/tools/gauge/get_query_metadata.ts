import type {
  GaugeGetQueryMetadataParams,
  GaugeGetQueryMetadataResponse,
} from '@/tools/gauge/types'
import { buildGaugeUrl, gaugeAuthParams, gaugeHeaders, gaugeOAuth } from '@/tools/gauge/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const gaugeGetQueryMetadataTool: ToolConfig<
  GaugeGetQueryMetadataParams,
  GaugeGetQueryMetadataResponse
> = {
  id: 'gauge_get_query_metadata',
  name: 'Gauge Get Query Metadata',
  description: 'Discover available report datasets, metrics, dimensions, filters, and values.',
  version: '1.0.0',
  oauth: gaugeOAuth,
  params: {
    ...gaugeAuthParams,
    org: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Organization slug or UUID',
    },
    dataset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Report dataset: answers, citations, searchQueries, or aiTraffic',
    },
  },
  request: {
    url: (params) =>
      buildGaugeUrl(`/orgs/${safeUrlPathSegment(params.org, 'org')}/query/metadata`, {
        dataset: params.dataset,
      }),
    method: 'GET',
    headers: (params) => gaugeHeaders(params.accessToken, false),
  },
  transformResponse: async (response) => {
    const data = (await response.json()) as Record<string, unknown>
    return { success: true, output: { catalog: data } }
  },
  outputs: {
    catalog: {
      type: 'json',
      description: 'Dynamic dataset, metric, dimension, and filter catalog returned by Gauge',
    },
  },
}
