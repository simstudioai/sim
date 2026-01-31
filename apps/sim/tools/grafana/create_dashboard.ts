import type {
  GrafanaCreateDashboardParams,
  GrafanaCreateDashboardResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const createDashboardTool: ToolConfig<
  GrafanaCreateDashboardParams,
  GrafanaCreateDashboardResponse
> = {
  id: 'grafana_create_dashboard',
  name: 'Grafana Create Dashboard',
  description: 'Create a new dashboard',
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
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The title of the new dashboard',
    },
    folderUid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The UID of the folder to create the dashboard in (e.g., folder-abc123)',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of tags',
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
      description: 'Overwrite existing dashboard with same title',
    },
    message: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Commit message for the dashboard version',
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
        title: params.title,
        tags: params.tags
          ? params.tags
              .split(',')
              .map((t) => t.trim())
              .filter((t) => t)
          : [],
        timezone: params.timezone || 'browser',
        schemaVersion: 39,
        version: 0,
        refresh: params.refresh || '',
      }

      if (params.panels) {
        try {
          dashboard.panels = JSON.parse(params.panels)
        } catch {
          dashboard.panels = []
        }
      } else {
        dashboard.panels = []
      }

      const body: Record<string, any> = {
        dashboard,
        overwrite: params.overwrite || false,
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
      description: 'The numeric ID of the created dashboard',
    },
    uid: {
      type: 'string',
      description: 'The UID of the created dashboard',
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
      description: 'The version number of the dashboard',
    },
    slug: {
      type: 'string',
      description: 'URL-friendly slug of the dashboard',
    },
  },
}
