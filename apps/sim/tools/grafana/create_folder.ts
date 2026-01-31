import type { GrafanaCreateFolderParams, GrafanaCreateFolderResponse } from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

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
        visibility: 'user-or-llm',
        description: 'Organization ID for multi-org Grafana instances (e.g., 1, 2)',
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
      hasAcl: {
        type: 'boolean',
        description: 'Whether the folder has custom ACL permissions',
      },
      canSave: {
        type: 'boolean',
        description: 'Whether the current user can save the folder',
      },
      canEdit: {
        type: 'boolean',
        description: 'Whether the current user can edit the folder',
      },
      canAdmin: {
        type: 'boolean',
        description: 'Whether the current user has admin rights on the folder',
      },
      canDelete: {
        type: 'boolean',
        description: 'Whether the current user can delete the folder',
      },
      createdBy: {
        type: 'string',
        description: 'Username of who created the folder',
      },
      created: {
        type: 'string',
        description: 'Timestamp when the folder was created',
      },
      updatedBy: {
        type: 'string',
        description: 'Username of who last updated the folder',
      },
      updated: {
        type: 'string',
        description: 'Timestamp when the folder was last updated',
      },
      version: {
        type: 'number',
        description: 'Version number of the folder',
      },
    },
  }
