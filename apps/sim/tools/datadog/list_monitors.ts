import type { ListMonitorsParams, ListMonitorsResponse, MonitorData } from '@/tools/datadog/types'
import { datadogErrorMessage, resolveDatadogSite } from '@/tools/datadog/utils'
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
        'Comma-separated group states to filter by. Valid values are "all", "alert", "warn", and "no data" (e.g., "alert,warn").',
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
      description:
        'Page to start paginating from (0-indexed, e.g., 0, 1, 2). Datadog returns every monitor in the org without pagination when this is not specified, so set it to bound the response. Setting Page Size alone implies page 0.',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Number of monitors per page (e.g., 50, max: 1000). Datadog only applies this when a page is specified — otherwise it returns all monitors with no page size limit — so setting this alone sends page 0. With a page but no page size, Datadog defaults to 100.',
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
      const site = resolveDatadogSite(params.site)
      const queryParams = new URLSearchParams()

      if (params.groupStates) queryParams.set('group_states', params.groupStates)
      if (params.name) queryParams.set('name', params.name)
      if (params.tags) queryParams.set('tags', params.tags)
      if (params.monitorTags) queryParams.set('monitor_tags', params.monitorTags)
      if (params.withDowntimes) queryParams.set('with_downtimes', 'true')
      /**
       * Datadog ignores `page_size` unless `page` is also sent — without a page
       * it "returns all monitors without a `page_size` limit". A user who sets
       * only a page size gets every monitor in the org from a control that reads
       * as a bound, so imply the first page for them. `page` is not defaulted
       * when neither is set: that would silently truncate a caller who is
       * relying on the documented return-everything behavior.
       */
      const page =
        params.page !== undefined && params.page !== null
          ? params.page
          : params.pageSize
            ? 0
            : undefined
      if (page !== undefined) queryParams.set('page', String(page))
      if (params.pageSize) queryParams.set('page_size', String(params.pageSize))

      const queryString = queryParams.toString()
      return `https://api.${site}/api/v1/monitor${queryString ? `?${queryString}` : ''}`
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
      const message = await datadogErrorMessage(response)
      return {
        success: false,
        output: {
          monitors: [],
        },
        error: message,
      }
    }

    const text = await response.text()
    let data: unknown
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

    const monitors = (data as MonitorData[]).map((m) => ({
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
          message: { type: 'string', description: 'Notification message' },
          overall_state: { type: 'string', description: 'Current state' },
          tags: { type: 'array', description: 'Tags' },
          priority: { type: 'number', description: 'Monitor priority' },
          options: {
            type: 'json',
            description: 'Monitor options (thresholds, notification settings)',
          },
          created: { type: 'string', description: 'Creation timestamp' },
          modified: { type: 'string', description: 'Last modification timestamp' },
          creator: { type: 'json', description: 'Monitor creator (email, handle, name)' },
        },
      },
    },
  },
}
