import type {
  DatadogV2Resource,
  DowntimeAttributes,
  ListDowntimesParams,
  ListDowntimesResponse,
} from '@/tools/datadog/types'
import { datadogErrorMessage, resolveDatadogSite } from '@/tools/datadog/utils'
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Number of downtimes to return per page. Datadog defaults to 30 and declares no maximum; keep this at 100 or below to stay within the bound Sim recommends.',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first downtime to return (e.g., 0, 30, 60)',
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

      if (params.currentOnly) queryParams.set('current_only', 'true')
      if (params.limit !== undefined) queryParams.set('page[limit]', String(params.limit))
      if (params.offset !== undefined) queryParams.set('page[offset]', String(params.offset))

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
      const message = await datadogErrorMessage(response)
      return {
        success: false,
        output: {
          downtimes: [],
        },
        error: message,
      }
    }

    const data = await response.json()
    const downtimes = (data.data || []).map((d: DatadogV2Resource<DowntimeAttributes>) => {
      const attrs: DowntimeAttributes = d.attributes || {}
      return {
        id: d.id,
        scope: attrs.scope ? [attrs.scope] : [],
        message: attrs.message,
        start: attrs.schedule?.start ? new Date(attrs.schedule.start).getTime() / 1000 : undefined,
        end: attrs.schedule?.end ? new Date(attrs.schedule.end).getTime() / 1000 : undefined,
        timezone: attrs.display_timezone ?? undefined,
        active: attrs.status === 'active',
        created: attrs.created ? new Date(attrs.created).getTime() / 1000 : undefined,
        modified: attrs.modified ? new Date(attrs.modified).getTime() / 1000 : undefined,
      }
    })

    return {
      success: true,
      output: {
        downtimes,
        totalCount: data.meta?.page?.total_filtered_count,
      },
    }
  },

  outputs: {
    totalCount: {
      type: 'number',
      description: 'Total number of downtimes matching the filter, across all pages',
      optional: true,
    },
    downtimes: {
      type: 'array',
      description: 'List of downtimes',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Downtime UUID' },
          scope: { type: 'array', description: 'Downtime scope' },
          message: { type: 'string', description: 'Downtime message' },
          start: { type: 'number', description: 'Start time (Unix timestamp)' },
          end: { type: 'number', description: 'End time (Unix timestamp)' },
          timezone: { type: 'string', description: 'Display timezone for the downtime' },
          active: { type: 'boolean', description: 'Whether downtime is currently active' },
          created: { type: 'number', description: 'Creation time (Unix timestamp)' },
          modified: { type: 'number', description: 'Last modification time (Unix timestamp)' },
        },
      },
    },
  },
}
