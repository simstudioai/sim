import type {
  GrafanaUpdateDashboardParams,
  GrafanaUpdateDashboardResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const updateDashboardTool: ToolConfig<
  GrafanaUpdateDashboardParams,
  GrafanaUpdateDashboardResponse
> = {
  id: 'grafana_update_dashboard',
  name: 'Grafana Update Dashboard',
  description: 'Update an existing dashboard',
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
      visibility: 'user-only',
      description: 'Organization ID for multi-org Grafana instances',
    },
    dashboardUid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UID of the dashboard to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New title for the dashboard',
    },
    folderUid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New folder UID to move the dashboard to',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of new tags',
    },
    timezone: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Dashboard timezone (e.g., browser, utc)',
    },
    refresh: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Auto-refresh interval (e.g., 5s, 1m, 5m)',
    },
    panels: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of panel configurations',
    },
    overwrite: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Overwrite even if there is a version conflict',
    },
    message: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Commit message for this version',
    },
  },

  request: {
    url: (params) => `${params.baseUrl.replace(/\/$/, '')}/api/dashboards/db`,
    method: 'POST',
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
    body: (params) => {
      const dashboard: Record<string, any> = {
        uid: params.dashboardUid,
      }

      if (params.title) dashboard.title = params.title
      if (params.tags) {
        dashboard.tags = params.tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t)
      }
      if (params.timezone) dashboard.timezone = params.timezone
      if (params.refresh) dashboard.refresh = params.refresh
      if (params.panels) {
        try {
          dashboard.panels = JSON.parse(params.panels)
        } catch {
          // Keep existing panels if parse fails
        }
      }

      const body: Record<string, any> = {
        dashboard,
        overwrite: params.overwrite !== false,
      }

      if (params.folderUid) {
        body.folderUid = params.folderUid
      }

      if (params.message) {
        body.message = params.message
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id,
        uid: data.uid,
        url: data.url,
        status: data.status,
        version: data.version,
        slug: data.slug,
      },
    }
  },

  outputs: {
    id: {
      type: 'number',
      description: 'The numeric ID of the updated dashboard',
    },
    uid: {
      type: 'string',
      description: 'The UID of the updated dashboard',
    },
    url: {
      type: 'string',
      description: 'The URL path to the dashboard',
    },
    status: {
      type: 'string',
      description: 'Status of the operation (success)',
    },
    version: {
      type: 'number',
      description: 'The new version number of the dashboard',
    },
    slug: {
      type: 'string',
      description: 'URL-friendly slug of the dashboard',
    },
  },
}
