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
      parentUid: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Parent folder UID for nested folders (requires nested folders enabled)',
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
        const body: Record<string, unknown> = {
          title: params.title,
        }

        if (params.uid) body.uid = params.uid
        if (params.parentUid) body.parentUid = params.parentUid

        return body
      },
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
      id: { type: 'number', description: 'The numeric ID of the created folder' },
      uid: { type: 'string', description: 'The UID of the created folder' },
      title: { type: 'string', description: 'The title of the created folder' },
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
