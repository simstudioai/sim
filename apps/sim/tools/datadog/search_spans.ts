import type {
  DatadogV2Resource,
  SearchSpansParams,
  SearchSpansResponse,
  SpanAttributes,
} from '@/tools/datadog/types'
import { datadogApiUrl, datadogErrorMessage, datadogHeaders } from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const searchSpansTool: ToolConfig<SearchSpansParams, SearchSpansResponse> = {
  id: 'datadog_search_spans',
  name: 'Datadog Search Spans',
  description: 'Search indexed APM spans using the span query syntax, with cursor pagination.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Span search query (e.g., "service:web* AND @http.status_code:[500 TO 599]"). Defaults to "*"',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum time, ISO-8601, date math, or milliseconds (default: "now-15m")',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum time, ISO-8601, date math, or milliseconds (default: "now")',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: "timestamp" for oldest first, "-timestamp" for newest first',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor returned as nextCursor by a previous call',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of spans to return (default: 10, max: 1000)',
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
    url: (params) => datadogApiUrl(params.site, '/api/v2/spans/events/search'),
    method: 'POST',
    headers: datadogHeaders,
    body: (params) => {
      const filter: Record<string, string> = {}
      if (params.query) filter.query = params.query
      if (params.from) filter.from = params.from
      if (params.to) filter.to = params.to

      const page: Record<string, string | number> = {}
      if (params.cursor) page.cursor = params.cursor
      if (params.limit !== undefined) page.limit = params.limit

      const attributes: Record<string, unknown> = {}
      if (Object.keys(filter).length > 0) attributes.filter = filter
      if (Object.keys(page).length > 0) attributes.page = page
      if (params.sort) attributes.sort = params.sort

      return { data: { type: 'search_request', attributes } }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { spans: [] },
        error: await datadogErrorMessage(response),
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        spans: (data.data ?? []).map((span: DatadogV2Resource<SpanAttributes>) => ({
          id: span.id,
          type: span.type,
          attributes: span.attributes ?? {},
        })),
        nextCursor: data.meta?.page?.after,
        elapsed: data.meta?.elapsed,
      },
    }
  },

  outputs: {
    spans: {
      type: 'array',
      description: 'List of matching spans',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique span event ID' },
          type: { type: 'string', description: 'Resource type (spans)' },
          attributes: {
            type: 'object',
            description: 'Span attributes',
            properties: {
              service: { type: 'string', description: 'Service that emitted the span' },
              resource_name: { type: 'string', description: 'Resource name' },
              env: { type: 'string', description: 'Environment' },
              host: { type: 'string', description: 'Host that emitted the span' },
              type: { type: 'string', description: 'Span type, such as web or db' },
              trace_id: { type: 'string', description: 'Trace ID' },
              span_id: { type: 'string', description: 'Span ID' },
              parent_id: { type: 'string', description: 'Parent span ID' },
              start_timestamp: { type: 'string', description: 'Span start timestamp' },
              end_timestamp: { type: 'string', description: 'Span end timestamp' },
              tags: { type: 'array', description: 'Tags on the span' },
              custom: { type: 'object', description: 'Custom span data' },
            },
          },
        },
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page of spans',
      optional: true,
    },
    elapsed: {
      type: 'number',
      description: 'Query time in milliseconds',
      optional: true,
    },
  },
}
