import {
  bufferInputDescription,
  bufferOutputProperties,
  bufferSelection,
  parseBufferInput,
  projectBufferObject,
} from '@/tools/buffer/schema'
import {
  BUFFER_API_URL,
  type BufferAggregatedMetricsParams,
  type BufferAggregatedMetricsResponse,
  bufferHeaders,
  bufferStringList,
  parseBufferGraphQLResponse,
} from '@/tools/buffer/types'
import type { ToolConfig } from '@/tools/types'

export const bufferGetAggregatedPostMetricsTool: ToolConfig<
  BufferAggregatedMetricsParams,
  BufferAggregatedMetricsResponse
> = {
  id: 'buffer_get_aggregated_post_metrics',
  name: 'Buffer Get Aggregated Post Metrics',
  description:
    'Aggregate published post metrics across an organization or selected channels over a date range of up to 365 days',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Buffer API key with insights:read permission',
    },
    organizationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Buffer organization ID',
    },
    startDateTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start of aggregation window as an ISO 8601 timestamp',
    },
    endDateTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End of aggregation window as an ISO 8601 timestamp',
    },
    channelIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Channel ID array or comma-separated IDs. Omit for all permitted channels; [] returns an empty result.',
    },
    tags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: bufferInputDescription('TagComparator'),
    },
  },
  request: {
    url: BUFFER_API_URL,
    method: 'POST',
    headers: (params) => bufferHeaders(params.apiKey),
    body: (params) => {
      const input = parseBufferInput('AggregatedPostMetricsInput', {
        organizationId: params.organizationId,
        startDateTime: params.startDateTime,
        endDateTime: params.endDateTime,
        ...(params.channelIds !== undefined
          ? { channelIds: bufferStringList(params.channelIds) }
          : {}),
        ...(params.tags !== undefined ? { tags: params.tags } : {}),
      })
      const duration = Date.parse(params.endDateTime) - Date.parse(params.startDateTime)
      if (duration < 0 || duration > 365 * 24 * 60 * 60 * 1000)
        throw new Error('Metrics window must be ordered and at most 365 days')
      return {
        query: `query AggregatedPostMetrics($input: AggregatedPostMetricsInput!) { aggregatedPostMetrics(input: $input) { ${bufferSelection('AggregatedPostMetrics')} } }`,
        variables: { input },
      }
    },
  },
  transformResponse: async (response) => {
    const data = await parseBufferGraphQLResponse(response)
    return {
      success: true,
      output: {
        aggregatedPostMetrics: projectBufferObject(
          'AggregatedPostMetrics',
          data.aggregatedPostMetrics
        ),
      },
    }
  },
  outputs: {
    aggregatedPostMetrics: {
      type: 'object',
      description: 'Aggregated performance metrics',
      properties: bufferOutputProperties('AggregatedPostMetrics'),
    },
  },
}
