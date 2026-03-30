import type { ToolConfig } from '@/tools/types'
import type { ProfoundBotLogsParams, ProfoundBotLogsResponse } from './types'

export const profoundBotLogsTool: ToolConfig<ProfoundBotLogsParams, ProfoundBotLogsResponse> = {
  id: 'profound_bot_logs',
  name: 'Profound Bot Logs',
  description: 'Get identified bot visit logs with filters for a domain in Profound',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Profound API Key',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Domain to query bot logs for (e.g. example.com)',
    },
    startDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start date (YYYY-MM-DD or ISO 8601)',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date (YYYY-MM-DD or ISO 8601). Defaults to now',
    },
    dimensions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated dimensions: timestamp, method, host, path, status_code, ip, user_agent, referer, bytes_sent, duration_ms, query_params, bot_name, bot_provider, bot_types',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of filter objects, e.g. [{"field":"bot_name","operator":"is","value":"GPTBot"}]',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (default 10000, max 50000)',
    },
  },

  request: {
    url: 'https://api.tryprofound.com/v1/logs/raw/bots',
    method: 'POST',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        domain: params.domain,
        start_date: params.startDate,
        metrics: ['count'],
      }
      if (params.endDate) {
        body.end_date = params.endDate
      }
      if (params.dimensions) {
        body.dimensions = params.dimensions.split(',').map((d) => d.trim())
      }
      if (params.filters) {
        try {
          body.filters = JSON.parse(params.filters)
        } catch {
          throw new Error('Invalid JSON in filters parameter')
        }
      }
      if (params.limit != null) {
        body.pagination = { limit: params.limit }
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.detail?.[0]?.msg || 'Failed to get bot logs')
    }
    if (Array.isArray(data)) {
      return {
        success: true,
        output: {
          totalRows: data.length,
          data: data.map((row: { metrics: number[]; dimensions: string[] }) => ({
            metrics: row.metrics ?? [],
            dimensions: row.dimensions ?? [],
          })),
        },
      }
    }
    return {
      success: true,
      output: {
        totalRows: data.info?.total_rows ?? 0,
        data: (data.data ?? []).map((row: { metrics: number[]; dimensions: string[] }) => ({
          metrics: row.metrics ?? [],
          dimensions: row.dimensions ?? [],
        })),
      },
    }
  },

  outputs: {
    totalRows: {
      type: 'number',
      description: 'Total number of bot log entries',
    },
    data: {
      type: 'json',
      description: 'Bot log data rows with metrics and dimension values',
      properties: {
        metrics: { type: 'json', description: 'Array of metric values (count)' },
        dimensions: {
          type: 'json',
          description: 'Array of dimension values matching requested dimensions order',
        },
      },
    },
  },
}
