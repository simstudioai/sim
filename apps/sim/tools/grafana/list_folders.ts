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
      visibility: 'user-or-llm',
      description: 'Organization ID for multi-org Grafana instances (e.g., 1, 2)',
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
    parentUid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'List children of this folder UID (requires nested folders enabled)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.baseUrl.replace(/\/$/, '')
      const searchParams = new URLSearchParams()

      if (params.limit) searchParams.set('limit', String(params.limit))
      if (params.page) searchParams.set('page', String(params.page))
      if (params.parentUid) searchParams.set('parentUid', params.parentUid.trim())

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
          ? data.map((f: Record<string, unknown>) => ({
              id: (f.id as number) ?? null,
              uid: (f.uid as string) ?? null,
              title: (f.title as string) ?? null,
              url: (f.url as string) ?? null,
              parentUid: (f.parentUid as string) ?? null,
              parents: (f.parents as { uid: string; title: string; url: string }[]) ?? [],
              hasAcl: (f.hasAcl as boolean) ?? null,
              canSave: (f.canSave as boolean) ?? null,
              canEdit: (f.canEdit as boolean) ?? null,
              canAdmin: (f.canAdmin as boolean) ?? null,
              createdBy: (f.createdBy as string) ?? null,
              created: (f.created as string) ?? null,
              updatedBy: (f.updatedBy as string) ?? null,
              updated: (f.updated as string) ?? null,
              version: (f.version as number) ?? null,
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
          url: { type: 'string', description: 'Folder URL path', optional: true },
          parentUid: {
            type: 'string',
            description: 'Parent folder UID (nested folders only)',
            optional: true,
          },
          parents: {
            type: 'array',
            description: 'Ancestor folder hierarchy (nested folders only)',
            optional: true,
          },
          hasAcl: {
            type: 'boolean',
            description: 'Whether the folder has custom ACL permissions',
            optional: true,
          },
          canSave: {
            type: 'boolean',
            description: 'Whether the current user can save the folder',
            optional: true,
          },
          canEdit: {
            type: 'boolean',
            description: 'Whether the current user can edit the folder',
            optional: true,
          },
          canAdmin: {
            type: 'boolean',
            description: 'Whether the current user has admin rights',
            optional: true,
          },
          createdBy: {
            type: 'string',
            description: 'Username of who created the folder',
            optional: true,
          },
          created: {
            type: 'string',
            description: 'Timestamp when the folder was created',
            optional: true,
          },
          updatedBy: {
            type: 'string',
            description: 'Username of who last updated the folder',
            optional: true,
          },
          updated: {
            type: 'string',
            description: 'Timestamp when the folder was last updated',
            optional: true,
          },
          version: { type: 'number', description: 'Folder version number', optional: true },
        },
      },
    },
  },
}
