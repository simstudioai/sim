import type { GetMonitorParams, GetMonitorResponse } from '@/tools/datadog/types'
import type { ToolConfig } from '@/tools/types'

export const getMonitorTool: ToolConfig<GetMonitorParams, GetMonitorResponse> = {
  id: 'datadog_get_monitor',
  name: 'Datadog Get Monitor',
  description: 'Retrieve details of a specific monitor by ID.',
  version: '1.0.0',

  params: {
    monitorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the monitor to retrieve (e.g., "12345678")',
    },
    groupStates: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated group states to include (e.g., "alert,warn", "alert,warn,no data,ok")',
    },
    withDowntimes: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include downtime data with the monitor',
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
      const queryParams = new URLSearchParams()

      if (params.groupStates) queryParams.set('group_states', params.groupStates)
      if (params.withDowntimes) queryParams.set('with_downtimes', 'true')

      const queryString = queryParams.toString()
      return `https://api.${site}/api/v1/monitor/${params.monitorId}${queryString ? `?${queryString}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'DD-API-KEY': params.apiKey,
      'DD-APPLICATION-KEY': params.applicationKey,
    }),
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
      description: 'The monitor details',
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
