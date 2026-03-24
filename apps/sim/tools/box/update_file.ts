import type { ToolConfig } from '@/tools/types'
import type { BoxFileInfoResponse, BoxUpdateFileParams } from './types'
import { FILE_OUTPUT_PROPERTIES } from './types'

export const boxUpdateFileTool: ToolConfig<BoxUpdateFileParams, BoxFileInfoResponse> = {
  id: 'box_update_file',
  name: 'Box Update File',
  description: 'Update file info in Box (rename, move, change description, add tags)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'box',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Box API',
    },
    fileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the file to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the file',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description for the file (max 256 characters)',
    },
    parentFolderId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Move the file to a different folder by specifying the folder ID',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tags to set on the file',
    },
  },

  request: {
    url: (params) => `https://api.box.com/2.0/files/${params.fileId.trim()}`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.name) body.name = params.name
      if (params.description !== undefined) body.description = params.description
      if (params.parentFolderId) body.parent = { id: params.parentFolderId.trim() }
      if (params.tags)
        body.tags = params.tags
          .split(',')
          .map((t: string) => t.trim())
          .filter(Boolean)
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || `Box API error: ${response.status}`)
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        name: data.name ?? '',
        description: data.description ?? null,
        size: data.size ?? 0,
        sha1: data.sha1 ?? null,
        createdAt: data.created_at ?? null,
        modifiedAt: data.modified_at ?? null,
        createdBy: data.created_by
          ? {
              id: data.created_by.id,
              name: data.created_by.name,
              login: data.created_by.login,
            }
          : null,
        modifiedBy: data.modified_by
          ? {
              id: data.modified_by.id,
              name: data.modified_by.name,
              login: data.modified_by.login,
            }
          : null,
        ownedBy: data.owned_by
          ? {
              id: data.owned_by.id,
              name: data.owned_by.name,
              login: data.owned_by.login,
            }
          : null,
        parentId: data.parent?.id ?? null,
        parentName: data.parent?.name ?? null,
        sharedLink: data.shared_link ?? null,
        tags: data.tags ?? [],
        commentCount: data.comment_count ?? null,
      },
    }
  },

  outputs: FILE_OUTPUT_PROPERTIES,
}
