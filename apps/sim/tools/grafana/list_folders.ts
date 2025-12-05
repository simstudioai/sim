import type { GrafanaListFoldersParams, GrafanaListFoldersResponse } from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const listFoldersTool: ToolConfig<GrafanaListFoldersParams, GrafanaListFoldersResponse> = {
  id: 'grafana_list_folders',
  name: 'Grafana List Folders',
  description: 'List all folders in Grafana',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of folders to return',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Page number for pagination',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.baseUrl.replace(/\/$/, '')
      const searchParams = new URLSearchParams()

      if (params.limit) searchParams.set('limit', String(params.limit))
      if (params.page) searchParams.set('page', String(params.page))

      const queryString = searchParams.toString()
      return `${baseUrl}/api/folders${queryString ? `?${queryString}` : ''}`
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
        folders: Array.isArray(data)
          ? data.map((f: any) => ({
              id: f.id,
              uid: f.uid,
              title: f.title,
              url: f.url,
              hasAcl: f.hasAcl || false,
              canSave: f.canSave || false,
              canEdit: f.canEdit || false,
              canAdmin: f.canAdmin || false,
              canDelete: f.canDelete || false,
              createdBy: f.createdBy || '',
              created: f.created || '',
              updatedBy: f.updatedBy || '',
              updated: f.updated || '',
              version: f.version || 0,
            }))
          : [],
      },
    }
  },

  outputs: {
    folders: {
      type: 'array',
      description: 'List of folders',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Folder ID' },
          uid: { type: 'string', description: 'Folder UID' },
          title: { type: 'string', description: 'Folder title' },
          url: { type: 'string', description: 'Folder URL path' },
        },
      },
    },
  },
}
