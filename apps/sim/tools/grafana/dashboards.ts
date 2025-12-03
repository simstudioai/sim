import type {
  GrafanaCreateDashboardParams,
  GrafanaCreateDashboardResponse,
  GrafanaDeleteDashboardParams,
  GrafanaDeleteDashboardResponse,
  GrafanaGetDashboardParams,
  GrafanaGetDashboardResponse,
  GrafanaListDashboardsParams,
  GrafanaListDashboardsResponse,
  GrafanaUpdateDashboardParams,
  GrafanaUpdateDashboardResponse,
} from '@/tools/grafana/types'
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
        visibility: 'user-only',
        description: 'Organization ID for multi-org Grafana instances',
      },
      dashboardUid: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The UID of the dashboard to retrieve',
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

export const listDashboardsTool: ToolConfig<
  GrafanaListDashboardsParams,
  GrafanaListDashboardsResponse
> = {
  id: 'grafana_list_dashboards',
  name: 'Grafana List Dashboards',
  description: 'Search and list all dashboards',
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
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query to filter dashboards by title',
    },
    tag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by tag (comma-separated for multiple tags)',
    },
    folderIds: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by folder IDs (comma-separated)',
    },
    starred: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Only return starred dashboards',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of dashboards to return',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.baseUrl.replace(/\/$/, '')
      const searchParams = new URLSearchParams()
      searchParams.set('type', 'dash-db')

      if (params.query) searchParams.set('query', params.query)
      if (params.tag) {
        params.tag.split(',').forEach((t) => searchParams.append('tag', t.trim()))
      }
      if (params.folderIds) {
        params.folderIds.split(',').forEach((id) => searchParams.append('folderIds', id.trim()))
      }
      if (params.starred) searchParams.set('starred', 'true')
      if (params.limit) searchParams.set('limit', String(params.limit))

      return `${baseUrl}/api/search?${searchParams.toString()}`
    },
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
        dashboards: Array.isArray(data)
          ? data.map((d: any) => ({
              id: d.id,
              uid: d.uid,
              title: d.title,
              uri: d.uri,
              url: d.url,
              slug: d.slug,
              type: d.type,
              tags: d.tags || [],
              isStarred: d.isStarred || false,
              folderId: d.folderId,
              folderUid: d.folderUid,
              folderTitle: d.folderTitle,
              folderUrl: d.folderUrl,
              sortMeta: d.sortMeta,
            }))
          : [],
      },
    }
  },

  outputs: {
    dashboards: {
      type: 'array',
      description: 'List of dashboard search results',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Dashboard ID' },
          uid: { type: 'string', description: 'Dashboard UID' },
          title: { type: 'string', description: 'Dashboard title' },
          url: { type: 'string', description: 'Dashboard URL path' },
          tags: { type: 'array', description: 'Dashboard tags' },
          folderTitle: { type: 'string', description: 'Parent folder title' },
        },
      },
    },
  },
}

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
      visibility: 'user-only',
      description: 'Organization ID for multi-org Grafana instances',
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
      description: 'The UID of the folder to create the dashboard in',
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
      visibility: 'user-only',
      description: 'Organization ID for multi-org Grafana instances',
    },
    dashboardUid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UID of the dashboard to delete',
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
