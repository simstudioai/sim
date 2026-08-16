import type { ListDashboardsParams, ListDashboardsResponse } from '@/tools/datadog/types'
import { datadogApiUrl, datadogErrorMessage, datadogHeaders } from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const listDashboardsTool: ToolConfig<ListDashboardsParams, ListDashboardsResponse> = {
  id: 'datadog_list_dashboards',
  name: 'Datadog List Dashboards',
  description:
    'List custom created or cloned dashboards. Datadog preset dashboards are not returned.',
  version: '1.0.0',

  params: {
    filterShared: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only shared dashboards',
    },
    filterDeleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only deleted dashboards. Incompatible with filterShared',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of dashboards to return (default: 100)',
    },
    start: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset of the first dashboard returned (e.g., 0, 100)',
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
    /**
     * Datadog treats `filter[shared]` and `filter[deleted]` as incompatible, so each is sent
     * only when the caller turned it on rather than sending both as `false`.
     */
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.filterShared) queryParams.set('filter[shared]', 'true')
      if (params.filterDeleted) queryParams.set('filter[deleted]', 'true')
      if (params.count !== undefined) queryParams.set('count', String(params.count))
      if (params.start !== undefined) queryParams.set('start', String(params.start))
      const queryString = queryParams.toString()
      return datadogApiUrl(params.site, `/api/v1/dashboard${queryString ? `?${queryString}` : ''}`)
    },
    method: 'GET',
    headers: datadogHeaders,
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { dashboards: [] },
        error: await datadogErrorMessage(response),
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: { dashboards: data.dashboards ?? [] },
    }
  },

  outputs: {
    dashboards: {
      type: 'array',
      description: 'List of dashboard summaries',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Dashboard ID' },
          title: { type: 'string', description: 'Dashboard title' },
          description: { type: 'string', description: 'Dashboard description' },
          layout_type: { type: 'string', description: 'Layout type: ordered or free' },
          url: { type: 'string', description: 'Dashboard URL path' },
          author_handle: { type: 'string', description: 'Handle of the dashboard author' },
          created_at: { type: 'string', description: 'Creation timestamp' },
          modified_at: { type: 'string', description: 'Modification timestamp' },
          is_read_only: { type: 'boolean', description: 'Whether the dashboard is read-only' },
        },
      },
    },
  },
}
