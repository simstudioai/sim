import type { GrafanaUpdateFolderParams } from '@/tools/grafana/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const updateFolderTool: ToolConfig<GrafanaUpdateFolderParams, ToolResponse> = {
  id: 'grafana_update_folder',
  name: 'Grafana Update Folder',
  description: 'Update (rename) a folder. Fetches the current folder and merges your changes.',
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
      description: 'The UID of the folder to update (e.g., folder-abc123)',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New title for the folder',
    },
  },

  request: {
    url: () => '/api/tools/grafana/update_folder',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      apiKey: params.apiKey,
      baseUrl: params.baseUrl,
      organizationId: params.organizationId,
      folderUid: params.folderUid,
      title: params.title,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: data.success ?? true,
      output: data.output ?? {},
      ...(data.error ? { error: data.error } : {}),
    }
  },

  outputs: {
    id: { type: 'number', description: 'The numeric ID of the folder' },
    uid: { type: 'string', description: 'The UID of the folder' },
    title: { type: 'string', description: 'The updated title of the folder' },
    url: { type: 'string', description: 'The URL path to the folder', optional: true },
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
      description: 'Whether the current user has admin rights on the folder',
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
    version: { type: 'number', description: 'Version number of the folder', optional: true },
  },
}
