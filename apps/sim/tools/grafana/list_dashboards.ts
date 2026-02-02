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
    folderIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by folder IDs (comma-separated, e.g., 1,2,3)',
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
