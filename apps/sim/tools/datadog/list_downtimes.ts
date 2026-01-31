import type { ListDowntimesParams, ListDowntimesResponse } from '@/tools/datadog/types'
import type { ToolConfig } from '@/tools/types'

export const listDowntimesTool: ToolConfig<ListDowntimesParams, ListDowntimesResponse> = {
  id: 'datadog_list_downtimes',
  name: 'Datadog List Downtimes',
  description: 'List all scheduled downtimes in Datadog.',
  version: '1.0.0',

  params: {
    currentOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return currently active downtimes',
    },
    monitorId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by monitor ID (e.g., "12345678")',
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

      if (params.currentOnly) queryParams.set('current_only', 'true')
      if (params.monitorId) queryParams.set('monitor_id', params.monitorId)

      const queryString = queryParams.toString()
      return `https://api.${site}/api/v2/downtime${queryString ? `?${queryString}` : ''}`
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
          downtimes: [],
        },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const downtimes = (data.data || []).map((d: any) => {
      const attrs = d.attributes || {}
      return {
        id: d.id,
        scope: attrs.scope ? [attrs.scope] : [],
        message: attrs.message,
        start: attrs.schedule?.start ? new Date(attrs.schedule.start).getTime() / 1000 : undefined,
        end: attrs.schedule?.end ? new Date(attrs.schedule.end).getTime() / 1000 : undefined,
        timezone: attrs.schedule?.timezone,
        disabled: attrs.disabled,
        active: attrs.status === 'active',
        created: attrs.created ? new Date(attrs.created).getTime() / 1000 : undefined,
        modified: attrs.modified ? new Date(attrs.modified).getTime() / 1000 : undefined,
      }
    })

    return {
      success: true,
      output: {
        downtimes,
      },
    }
  },

  outputs: {
    downtimes: {
      type: 'array',
      description: 'List of downtimes',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Downtime ID' },
          scope: { type: 'array', description: 'Downtime scope' },
          message: { type: 'string', description: 'Downtime message' },
          start: { type: 'number', description: 'Start time (Unix timestamp)' },
          end: { type: 'number', description: 'End time (Unix timestamp)' },
          active: { type: 'boolean', description: 'Whether downtime is currently active' },
        },
      },
    },
  },
}
