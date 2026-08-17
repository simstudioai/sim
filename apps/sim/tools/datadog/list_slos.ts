import type { ListSlosParams, ListSlosResponse } from '@/tools/datadog/types'
import { datadogApiUrl, datadogErrorMessage, datadogHeaders } from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const listSlosTool: ToolConfig<ListSlosParams, ListSlosResponse> = {
  id: 'datadog_list_slos',
  name: 'Datadog List SLOs',
  description:
    'List service level objectives, optionally filtered by IDs, name, tags, or underlying metrics query.',
  version: '1.0.0',

  params: {
    ids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated SLO IDs to fetch (e.g., "id1,id2")',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter results by SLO name (e.g., "checkout latency")',
    },
    tagsQuery: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter results by a single SLO tag (e.g., "env:prod")',
    },
    metricsQuery: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter results by SLO numerator and denominator (e.g., "aws.elb.request_count")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of SLOs to return (default: 1000)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset of the first SLO returned (e.g., 0, 50)',
    },
    isDeleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Return only deleted SLOs',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog API key',
    },
    applicationKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog Application key',
    },
    site: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Datadog site/region (default: datadoghq.com)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.ids) queryParams.set('ids', params.ids)
      if (params.query) queryParams.set('query', params.query)
      if (params.tagsQuery) queryParams.set('tags_query', params.tagsQuery)
      if (params.metricsQuery) queryParams.set('metrics_query', params.metricsQuery)
      if (params.limit !== undefined) queryParams.set('limit', String(params.limit))
      if (params.offset !== undefined) queryParams.set('offset', String(params.offset))
      if (params.isDeleted) queryParams.set('is_deleted', 'true')
      const queryString = queryParams.toString()
      return datadogApiUrl(params.site, `/api/v1/slo${queryString ? `?${queryString}` : ''}`)
    },
    method: 'GET',
    headers: datadogHeaders,
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { slos: [] },
        error: await datadogErrorMessage(response),
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        slos: data.data ?? [],
      },
    }
  },

  outputs: {
    slos: {
      type: 'array',
      description: 'List of service level objectives',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'SLO ID' },
          name: { type: 'string', description: 'SLO name' },
          type: { type: 'string', description: 'SLO type: metric, monitor, or time_slice' },
          description: { type: 'string', description: 'SLO description' },
          tags: { type: 'array', description: 'SLO tags' },
          thresholds: { type: 'array', description: 'Timeframe targets and warnings' },
          target_threshold: { type: 'number', description: 'Primary target threshold' },
          warning_threshold: { type: 'number', description: 'Primary warning threshold' },
          timeframe: { type: 'string', description: 'Primary timeframe' },
          monitor_ids: { type: 'array', description: 'Monitor IDs for monitor-based SLOs' },
          created_at: { type: 'number', description: 'Creation timestamp (Unix seconds)' },
          modified_at: { type: 'number', description: 'Modification timestamp (Unix seconds)' },
        },
      },
    },
  },
}
