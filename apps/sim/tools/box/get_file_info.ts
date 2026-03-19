import type { ToolConfig } from '@/tools/types'
import type { BoxFileInfoResponse, BoxGetFileInfoParams } from './types'
import { FILE_OUTPUT_PROPERTIES } from './types'

export const boxGetFileInfoTool: ToolConfig<BoxGetFileInfoParams, BoxFileInfoResponse> = {
  id: 'box_get_file_info',
  name: 'Box Get File Info',
  description: 'Get detailed information about a file in Box',
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
      description: 'The ID of the file to get information about',
    },
  },

  request: {
    url: (params) => `https://api.box.com/2.0/files/${params.fileId.trim()}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
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
