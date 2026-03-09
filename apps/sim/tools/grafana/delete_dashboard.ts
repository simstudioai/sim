import type {
  GrafanaDeleteDashboardParams,
  GrafanaDeleteDashboardResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const deleteDashboardTool: ToolConfig<
  GrafanaDeleteDashboardParams,
  GrafanaDeleteDashboardResponse
> = {
  id: 'grafana_delete_dashboard',
  name: 'Grafana Delete Dashboard',
  description: 'Delete a dashboard by its UID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Grafana Service Account Token',
    },
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Grafana instance URL (e.g., https://your-grafana.com)',
    },
    organizationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Organization ID for multi-org Grafana instances (e.g., 1, 2)',
    },
    dashboardUid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UID of the dashboard to delete (e.g., abc123def)',
    },
  },

  request: {
    url: (params) =>
      `${params.baseUrl.replace(/\/$/, '')}/api/dashboards/uid/${params.dashboardUid}`,
    method: 'DELETE',
    headers: (params) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }
      if (params.organizationId) {
        headers['X-Grafana-Org-Id'] = params.organizationId
      }
      return headers
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        title: data.title || '',
        message: data.message || 'Dashboard deleted',
        id: data.id || 0,
      },
    }
  },

  outputs: {
    title: {
      type: 'string',
      description: 'The title of the deleted dashboard',
    },
    message: {
      type: 'string',
      description: 'Confirmation message',
    },
    id: {
      type: 'number',
      description: 'The ID of the deleted dashboard',
    },
  },
}
