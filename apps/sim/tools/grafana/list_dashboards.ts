import type {
  GrafanaListDashboardsParams,
  GrafanaListDashboardsResponse,
} from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

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
      visibility: 'user-or-llm',
      description: 'Organization ID for multi-org Grafana instances (e.g., 1, 2)',
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
    folderUIDs: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by folder UIDs (comma-separated, e.g., abc123,def456)',
    },
    dashboardUIDs: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by dashboard UIDs (comma-separated, e.g., abc123,def456)',
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
      description: 'Maximum number of dashboards to return (default 1000)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Page number for pagination (1-based)',
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
      if (params.folderUIDs) {
        params.folderUIDs.split(',').forEach((uid) => searchParams.append('folderUIDs', uid.trim()))
      }
      if (params.dashboardUIDs) {
        params.dashboardUIDs
          .split(',')
          .forEach((uid) => searchParams.append('dashboardUIDs', uid.trim()))
      }
      if (params.starred) searchParams.set('starred', 'true')
      if (params.limit) searchParams.set('limit', String(params.limit))
      if (params.page) searchParams.set('page', String(params.page))

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
          ? data.map((d: Record<string, unknown>) => ({
              id: (d.id as number) ?? null,
              uid: (d.uid as string) ?? null,
              title: (d.title as string) ?? null,
              uri: (d.uri as string) ?? null,
              url: (d.url as string) ?? null,
              type: (d.type as string) ?? null,
              tags: (d.tags as string[]) ?? [],
              isStarred: (d.isStarred as boolean) ?? false,
              folderId: (d.folderId as number) ?? null,
              folderUid: (d.folderUid as string) ?? null,
              folderTitle: (d.folderTitle as string) ?? null,
              folderUrl: (d.folderUrl as string) ?? null,
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
