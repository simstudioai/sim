import type { ListMonitorsParams, ListMonitorsResponse } from '@/tools/datadog/types'
import type { ToolConfig } from '@/tools/types'

export const listMonitorsTool: ToolConfig<ListMonitorsParams, ListMonitorsResponse> = {
  id: 'datadog_list_monitors',
  name: 'Datadog List Monitors',
  description: 'List all monitors in Datadog with optional filtering by name, tags, or state.',
  version: '1.0.0',

  params: {
    groupStates: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated group states to filter by (e.g., "alert,warn", "alert,warn,no data,ok")',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter monitors by name with partial match (e.g., "CPU", "Production")',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of tags to filter by (e.g., "env:prod,team:backend")',
    },
    monitorTags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of monitor tags to filter by (e.g., "service:api,priority:high")',
    },
    withDowntimes: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include downtime data with monitors',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination (0-indexed, e.g., 0, 1, 2)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of monitors per page (e.g., 50, max: 1000)',
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
      if (params.name) queryParams.set('name', params.name)
      if (params.tags) queryParams.set('tags', params.tags)
      if (params.monitorTags) queryParams.set('monitor_tags', params.monitorTags)
      if (params.withDowntimes) queryParams.set('with_downtimes', 'true')
      if (params.page !== undefined) queryParams.set('page', String(params.page))
      if (params.pageSize) queryParams.set('page_size', String(params.pageSize))

      const queryString = queryParams.toString()
      const url = `https://api.${site}/api/v1/monitor${queryString ? `?${queryString}` : ''}`
      console.log(
        '[Datadog List Monitors] URL:',
        url,
        'Site param:',
        params.site,
        'API Key present:',
        !!params.apiKey,
        'App Key present:',
        !!params.applicationKey
      )
      return url
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
          monitors: [],
        },
        error: errorData.errors?.[0] || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const text = await response.text()
    let data: any
    try {
      data = JSON.parse(text)
    } catch (e) {
      return {
        success: false,
        output: { monitors: [] },
        error: `Failed to parse response: ${text.substring(0, 200)}`,
      }
    }

    if (!Array.isArray(data)) {
      return {
        success: false,
        output: { monitors: [] },
        error: `Expected array but got: ${typeof data} - ${JSON.stringify(data).substring(0, 200)}`,
      }
    }

    const monitors = data.map((m: any) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      query: m.query,
      message: m.message,
      tags: m.tags,
      priority: m.priority,
      options: m.options,
      overall_state: m.overall_state,
      created: m.created,
      modified: m.modified,
      creator: m.creator,
    }))

    return {
      success: true,
      output: {
        monitors,
      },
    }
  },

  outputs: {
    monitors: {
      type: 'array',
      description: 'List of monitors',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Monitor ID' },
          name: { type: 'string', description: 'Monitor name' },
          type: { type: 'string', description: 'Monitor type' },
          query: { type: 'string', description: 'Monitor query' },
          overall_state: { type: 'string', description: 'Current state' },
          tags: { type: 'array', description: 'Tags' },
        },
      },
    },
  },
}
