import type { GrafanaGetDashboardParams, GrafanaGetDashboardResponse } from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const getDashboardTool: ToolConfig<GrafanaGetDashboardParams, GrafanaGetDashboardResponse> =
  {
    id: 'grafana_get_dashboard',
    name: 'Grafana Get Dashboard',
    description: 'Get a dashboard by its UID',
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
        description: 'The UID of the dashboard to retrieve (e.g., abc123def)',
      },
    },

    request: {
      url: (params) =>
        `${params.baseUrl.replace(/\/$/, '')}/api/dashboards/uid/${params.dashboardUid}`,
      method: 'GET',
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
          dashboard: data.dashboard,
          meta: data.meta,
        },
      }
    },

    outputs: {
      dashboard: {
        type: 'json',
        description: 'The full dashboard JSON object',
      },
      meta: {
        type: 'json',
        description: 'Dashboard metadata (version, permissions, etc.)',
      },
    },
  }
