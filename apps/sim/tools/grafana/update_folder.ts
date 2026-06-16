import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
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
    url: (params) => `${params.baseUrl.replace(/\/$/, '')}/api/folders/${params.folderUid.trim()}`,
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
      output: { _existingFolder: data },
    }
  },

  postProcess: async (result, params) => {
    const existingFolder = result.output._existingFolder

    if (!existingFolder || !existingFolder.uid) {
      return { success: false, output: {}, error: 'Failed to fetch existing folder' }
    }

    const body: Record<string, unknown> = {
      title: params.title ?? existingFolder.title,
      version: existingFolder.version,
      overwrite: true,
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }
    if (params.organizationId) {
      headers['X-Grafana-Org-Id'] = params.organizationId
    }

    const updateUrl = `${params.baseUrl.replace(/\/$/, '')}/api/folders/${params.folderUid.trim()}`
    const urlValidation = await validateUrlWithDNS(updateUrl, 'baseUrl')
    if (!urlValidation.isValid || !urlValidation.resolvedIP) {
      return {
        success: false,
        output: {},
        error: `Invalid Grafana baseUrl: ${urlValidation.error}`,
      }
    }

    const updateResponse = await secureFetchWithPinnedIP(updateUrl, urlValidation.resolvedIP, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    })

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text()
      return { success: false, output: {}, error: `Failed to update folder: ${errorText}` }
    }

    const data = (await updateResponse.json()) as Record<string, unknown>
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
