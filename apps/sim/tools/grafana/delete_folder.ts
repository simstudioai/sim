import type { GrafanaDeleteFolderParams, GrafanaDeleteFolderResponse } from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const deleteFolderTool: ToolConfig<GrafanaDeleteFolderParams, GrafanaDeleteFolderResponse> =
  {
    id: 'grafana_delete_folder',
    name: 'Grafana Delete Folder',
    description: 'Delete a folder by its UID',
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
      folderUid: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The UID of the folder to delete (e.g., folder-abc123)',
      },
      forceDeleteRules: {
        type: 'boolean',
        required: false,
        visibility: 'user-only',
        description: 'Delete any alert rules stored in the folder along with it (default false)',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = params.baseUrl.replace(/\/$/, '')
        const query = params.forceDeleteRules ? '?forceDeleteRules=true' : ''
        return `${baseUrl}/api/folders/${params.folderUid.trim()}${query}`
      },
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

    transformResponse: async (response: Response, params) => {
      const data = await response.json().catch(() => ({}))

      return {
        success: true,
        output: {
          id: (data.id as number) ?? null,
          uid: params?.folderUid?.trim() ?? null,
          message: (data.message as string) ?? null,
        },
      }
    },

    outputs: {
      id: {
        type: 'number',
        description: 'Numeric id of the deleted folder, as returned by Grafana',
        nullable: true,
      },
      uid: {
        type: 'string',
        description: 'The UID that was deleted, echoed from the request',
        nullable: true,
      },
      message: { type: 'string', description: "Grafana's confirmation message", nullable: true },
    },
  }
