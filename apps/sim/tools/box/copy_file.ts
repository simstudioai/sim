import type { BoxCopyFileParams, BoxCopyFileResponse } from '@/tools/box/types'
import type { ToolConfig } from '@/tools/types'

export const boxCopyFileTool: ToolConfig<BoxCopyFileParams, BoxCopyFileResponse> = {
  id: 'box_copy_file',
  name: 'Box Copy File',
  description: 'Create a copy of a file in Box',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'box',
  },

  params: {
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
    newName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional new name for the copy',
    },
  },

  request: {
    url: (params) => `https://api.box.com/2.0/files/${params.fileId}/copy`,
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Box API request')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const body: Record<string, unknown> = {
        parent: {
          id: params.parentFolderId,
        },
      }
      if (params.newName) {
        body.name = params.newName
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message || data.error_description || 'Failed to copy file',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        file: data,
      },
    }
  },

  outputs: {
    file: {
      type: 'object',
      description: 'The copied file',
      properties: {
        id: { type: 'string', description: 'File ID' },
        name: { type: 'string', description: 'File name' },
        parent: { type: 'object', description: 'Parent folder' },
        created_at: { type: 'string', description: 'Creation timestamp' },
      },
    },
  },
}
