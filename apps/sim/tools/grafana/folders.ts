import type {
  GrafanaCreateFolderParams,
  GrafanaCreateFolderResponse,
  GrafanaListFoldersParams,
  GrafanaListFoldersResponse,
} from '@/tools/grafana/types'
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

export const createFolderTool: ToolConfig<GrafanaCreateFolderParams, GrafanaCreateFolderResponse> =
  {
    id: 'grafana_create_folder',
    name: 'Grafana Create Folder',
    description: 'Create a new folder in Grafana',
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
        description: 'The title of the new folder',
      },
      uid: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional UID for the folder (auto-generated if not provided)',
      },
    },

    request: {
      url: (params) => `${params.baseUrl.replace(/\/$/, '')}/api/folders`,
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
        const body: Record<string, any> = {
          title: params.title,
        }

        if (params.uid) {
          body.uid = params.uid
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
          title: data.title,
          url: data.url,
          hasAcl: data.hasAcl || false,
          canSave: data.canSave || false,
          canEdit: data.canEdit || false,
          canAdmin: data.canAdmin || false,
          canDelete: data.canDelete || false,
          createdBy: data.createdBy || '',
          created: data.created || '',
          updatedBy: data.updatedBy || '',
          updated: data.updated || '',
          version: data.version || 0,
        },
      }
    },

    outputs: {
      id: {
        type: 'number',
        description: 'The numeric ID of the created folder',
      },
      uid: {
        type: 'string',
        description: 'The UID of the created folder',
      },
      title: {
        type: 'string',
        description: 'The title of the created folder',
      },
      url: {
        type: 'string',
        description: 'The URL path to the folder',
      },
    },
  }
