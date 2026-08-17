import type { DeleteDashboardParams, DeleteDashboardResponse } from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteDashboardTool: ToolConfig<DeleteDashboardParams, DeleteDashboardResponse> = {
  id: 'datadog_delete_dashboard',
  name: 'Datadog Delete Dashboard',
  description: 'Delete a dashboard by ID.',
  version: '1.0.0',

  params: {
    dashboardId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the dashboard to delete',
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
    method: 'DELETE',
    headers: datadogHeaders,
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { success: false },
        error: await datadogErrorMessage(response),
      }
    }

    const data = await response.json().catch(() => ({}))

    return {
      success: true,
      output: {
        success: true,
        deletedDashboardId: data.deleted_dashboard_id,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the dashboard was deleted',
    },
    deletedDashboardId: {
      type: 'string',
      description: 'ID of the deleted dashboard',
      optional: true,
    },
  },
}
