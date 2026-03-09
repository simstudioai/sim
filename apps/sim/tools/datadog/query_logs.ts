import type { QueryLogsParams, QueryLogsResponse } from '@/tools/datadog/types'
import type { ToolConfig } from '@/tools/types'

export const queryLogsTool: ToolConfig<QueryLogsParams, QueryLogsResponse> = {
  id: 'datadog_query_logs',
  name: 'Datadog Query Logs',
  description:
    'Search and retrieve logs from Datadog. Use for troubleshooting, analysis, or monitoring.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Log search query using Datadog query syntax (e.g., "service:web-app status:error", "host:prod-* @http.status_code:500")',
    },
    from: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Start time in ISO-8601 format or relative time (e.g., "now-1h", "now-15m", "2024-01-15T10:00:00Z")',
    },
    to: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'End time in ISO-8601 format or relative time (e.g., "now", "now-5m", "2024-01-15T12:00:00Z")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of logs to return (e.g., 50, 100, max: 1000)',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: "timestamp" for oldest first, "-timestamp" for newest first',
    },
    indexes: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of log indexes to search',
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
      const site = params.site || 'datadoghq.com'
      return `https://api.${site}/api/v2/logs/events/search`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'DD-API-KEY': params.apiKey,
      'DD-APPLICATION-KEY': params.applicationKey,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        filter: {
          query: params.query,
          from: params.from,
          to: params.to,
        },
        page: {
          limit: params.limit || 50,
        },
      }

      if (params.sort) {
        body.sort = params.sort
      }

      if (params.indexes) {
        body.filter.indexes = params.indexes
          .split(',')
          .map((i: string) => i.trim())
          .filter((i: string) => i.length > 0)
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: {
          logs: [],
        },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const logs = (data.data || []).map((log: any) => ({
      id: log.id,
      content: {
        timestamp: log.attributes?.timestamp,
        host: log.attributes?.host,
        service: log.attributes?.service,
        message: log.attributes?.message,
        status: log.attributes?.status,
        attributes: log.attributes?.attributes,
        tags: log.attributes?.tags,
      },
    }))

    return {
      success: true,
      output: {
        logs,
        nextLogId: data.meta?.page?.after,
      },
    }
  },

  outputs: {
    logs: {
      type: 'array',
      description: 'List of log entries',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Log ID' },
          content: {
            type: 'object',
            description: 'Log content',
            properties: {
              timestamp: { type: 'string', description: 'Log timestamp' },
              host: { type: 'string', description: 'Host name' },
              service: { type: 'string', description: 'Service name' },
              message: { type: 'string', description: 'Log message' },
              status: { type: 'string', description: 'Log status/level' },
            },
          },
        },
      },
    },
    nextLogId: {
      type: 'string',
      description: 'Cursor for pagination',
      optional: true,
    },
  },
}
