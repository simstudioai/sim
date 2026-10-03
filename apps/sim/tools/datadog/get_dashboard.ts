import type { GetDashboardParams, GetDashboardResponse } from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const getDashboardTool: ToolConfig<GetDashboardParams, GetDashboardResponse> = {
  id: 'datadog_get_dashboard',
  name: 'Datadog Get Dashboard',
  description: 'Get the full definition of a dashboard, including its widgets.',
  version: '1.0.0',

  params: {
    dashboardId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the dashboard (e.g., "abc-def-ghi")',
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
    url: (params) =>
      datadogApiUrl(params.site, `/api/v1/dashboard/${datadogPathSegment(params.dashboardId)}`),
    method: 'GET',
    headers: datadogHeaders,
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { dashboard: {} },
        error: await datadogErrorMessage(response),
      }
    }

    return {
      success: true,
      output: { dashboard: await response.json() },
    }
  },

  outputs: {
    dashboard: {
      type: 'object',
      description: 'The dashboard definition',
      properties: {
        id: { type: 'string', description: 'Dashboard ID' },
        title: { type: 'string', description: 'Dashboard title' },
        description: { type: 'string', description: 'Dashboard description' },
        layout_type: { type: 'string', description: 'Layout type: ordered or free' },
        url: { type: 'string', description: 'Dashboard URL path' },
        author_handle: { type: 'string', description: 'Handle of the dashboard author' },
        author_name: { type: 'string', description: 'Name of the dashboard author' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        modified_at: { type: 'string', description: 'Modification timestamp' },
        tags: { type: 'array', description: 'Dashboard tags' },
        notify_list: { type: 'array', description: 'Handles notified on dashboard changes' },
        template_variables: { type: 'array', description: 'Template variable definitions' },
        widgets: { type: 'array', description: 'Widget definitions' },
      },
    },
  },
}
