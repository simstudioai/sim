import type { CreateMonitorParams, CreateMonitorResponse } from '@/tools/datadog/types'
import type { ToolConfig } from '@/tools/types'

export const createMonitorTool: ToolConfig<CreateMonitorParams, CreateMonitorResponse> = {
  id: 'datadog_create_monitor',
  name: 'Datadog Create Monitor',
  description:
    'Create a new monitor/alert in Datadog. Monitors can track metrics, service checks, events, and more.',
  version: '1.0.0',

  params: {
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Monitor name',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Monitor type: metric alert, service check, event alert, process alert, log alert, query alert, composite, synthetics alert, slo alert',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Monitor query (e.g., "avg(last_5m):avg:system.cpu.idle{*} < 20", "logs(\"status:error\").index(\"main\").rollup(\"count\").last(\"5m\") > 100")',
    },
    message: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Message to include with notifications. Can include @-mentions and markdown.',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of tags',
    },
    priority: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Monitor priority (1-5, where 1 is highest)',
    },
    options: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON string of monitor options (thresholds, notify_no_data, renotify_interval, etc.)',
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
      return `https://api.${site}/api/v1/monitor`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'DD-API-KEY': params.apiKey,
      'DD-APPLICATION-KEY': params.applicationKey,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        name: params.name,
        type: params.type,
        query: params.query,
      }

      if (params.message) body.message = params.message
      if (params.priority) body.priority = params.priority

      if (params.tags) {
        body.tags = params.tags
          .split(',')
          .map((t: string) => t.trim())
          .filter((t: string) => t.length > 0)
      }

      if (params.options) {
        try {
          body.options =
            typeof params.options === 'string' ? JSON.parse(params.options) : params.options
        } catch {
          // If options parsing fails, skip it
        }
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
          monitor: {} as any,
        },
        error: errorData.errors?.[0] || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: {
        monitor: {
          id: data.id,
          name: data.name,
          type: data.type,
          query: data.query,
          message: data.message,
          tags: data.tags,
          priority: data.priority,
          options: data.options,
          overall_state: data.overall_state,
          created: data.created,
          modified: data.modified,
          creator: data.creator,
        },
      },
    }
  },

  outputs: {
    monitor: {
      type: 'object',
      description: 'The created monitor details',
      properties: {
        id: { type: 'number', description: 'Monitor ID' },
        name: { type: 'string', description: 'Monitor name' },
        type: { type: 'string', description: 'Monitor type' },
        query: { type: 'string', description: 'Monitor query' },
        message: { type: 'string', description: 'Notification message' },
        tags: { type: 'array', description: 'Monitor tags' },
        priority: { type: 'number', description: 'Monitor priority' },
        overall_state: { type: 'string', description: 'Current monitor state' },
        created: { type: 'string', description: 'Creation timestamp' },
        modified: { type: 'string', description: 'Last modification timestamp' },
      },
    },
  },
}
