import type { ToolConfig } from '@/tools/types'
import type { BoxCopyFileParams, BoxUploadFileResponse } from './types'
import { UPLOAD_FILE_OUTPUT_PROPERTIES } from './types'

export const boxCopyFileTool: ToolConfig<BoxCopyFileParams, BoxUploadFileResponse> = {
  id: 'box_copy_file',
  name: 'Box Copy File',
  description: 'Copy a file to another folder in Box',
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
      description: 'The ID of the file to copy',
    },
    parentFolderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the destination folder',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional new name for the copied file',
    },
  },

  request: {
    url: (params) => `https://api.box.com/2.0/files/${params.fileId.trim()}/copy`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        parent: { id: params.parentFolderId.trim() },
      }
      if (params.name) body.name = params.name
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
        size: data.size ?? 0,
        sha1: data.sha1 ?? null,
        createdAt: data.created_at ?? null,
        modifiedAt: data.modified_at ?? null,
        parentId: data.parent?.id ?? null,
        parentName: data.parent?.name ?? null,
      },
    }
  },

  outputs: UPLOAD_FILE_OUTPUT_PROPERTIES,
}
