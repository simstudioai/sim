import type { GrafanaMoveFolderParams, GrafanaMoveFolderResponse } from '@/tools/grafana/types'
import type { ToolConfig } from '@/tools/types'

export const moveFolderTool: ToolConfig<GrafanaMoveFolderParams, GrafanaMoveFolderResponse> = {
  id: 'grafana_move_folder',
  name: 'Grafana Move Folder',
  description:
    'Move a folder under a different parent folder, or to the root by leaving the parent empty. Returns the folder with its new ancestry.',
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
      description: 'UID of the folder to move',
    },
    parentUid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UID of the new parent folder. Leave empty to move the folder to the root',
    },
  },

  request: {
    url: (params) =>
      `${params.baseUrl.replace(/\/$/, '')}/api/folders/${encodeURIComponent(
        params.folderUid.trim()
      )}/move`,
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
    /**
     * Grafana requires a body, and reads an empty `parentUid` as "move to the
     * root", so the key is always present rather than conditionally omitted.
     */
    body: (params) => ({ parentUid: params.parentUid?.trim() ?? '' }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        id: (data.id as number) ?? null,
        uid: (data.uid as string) ?? null,
        title: (data.title as string) ?? null,
        url: (data.url as string) ?? null,
        parentUid: (data.parentUid as string) ?? null,
        parents: (data.parents as { uid: string; title: string; url: string }[]) ?? [],
        hasAcl: (data.hasAcl as boolean) ?? null,
        canSave: (data.canSave as boolean) ?? null,
        canEdit: (data.canEdit as boolean) ?? null,
        canAdmin: (data.canAdmin as boolean) ?? null,
        createdBy: (data.createdBy as string) ?? null,
        created: (data.created as string) ?? null,
        updatedBy: (data.updatedBy as string) ?? null,
        updated: (data.updated as string) ?? null,
        version: (data.version as number) ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'number', description: 'The numeric ID of the folder', nullable: true },
    uid: { type: 'string', description: 'The UID of the folder', nullable: true },
    title: { type: 'string', description: 'The title of the folder', nullable: true },
    url: { type: 'string', description: 'The URL path of the folder', nullable: true },
    parentUid: {
      type: 'string',
      description: 'UID of the new parent folder, absent once moved to the root',
      nullable: true,
    },
    parents: {
      type: 'array',
      description: 'Folder ancestry from the root down to the parent (uid, title, url)',
    },
    hasAcl: {
      type: 'boolean',
      description: 'Whether the folder has custom ACL permissions',
      nullable: true,
    },
    canSave: {
      type: 'boolean',
      description: 'Whether the caller can save the folder',
      nullable: true,
    },
    canEdit: {
      type: 'boolean',
      description: 'Whether the caller can edit the folder',
      nullable: true,
    },
    canAdmin: {
      type: 'boolean',
      description: 'Whether the caller can administer the folder',
      nullable: true,
    },
    createdBy: { type: 'string', description: 'Login that created the folder', nullable: true },
    created: { type: 'string', description: 'Creation timestamp', nullable: true },
    updatedBy: {
      type: 'string',
      description: 'Login that last updated the folder',
      nullable: true,
    },
    updated: { type: 'string', description: 'Last update timestamp', nullable: true },
    version: { type: 'number', description: 'Folder revision number', nullable: true },
  },
}
