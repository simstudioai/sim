import type { BoxUpdateFileParams, BoxUpdateFileResponse } from '@/tools/box/types'
import type { ToolConfig } from '@/tools/types'

export const boxUpdateFileTool: ToolConfig<BoxUpdateFileParams, BoxUpdateFileResponse> = {
  id: 'box_update_file',
  name: 'Box Update File',
  description: 'Update file information in Box (rename, move, or update description)',
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
      description: 'New description for the file',
    },
    parentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the new parent folder (to move the file)',
    },
    tags: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of tags to set on the file',
      items: { type: 'string' },
    },
  },

  request: {
    url: (params) => `https://api.box.com/2.0/files/${params.fileId}`,
    method: 'PUT',
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
      const body: Record<string, unknown> = {}
      if (params.name) {
        body.name = params.name
      }
      if (params.description !== undefined) {
        body.description = params.description
      }
      if (params.parentId) {
        body.parent = { id: params.parentId }
      }
      if (params.tags) {
        body.tags = params.tags
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message || data.error_description || 'Failed to update file',
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
      description: 'The updated file',
      properties: {
        id: { type: 'string', description: 'File ID' },
        name: { type: 'string', description: 'File name' },
        description: { type: 'string', description: 'File description' },
        parent: { type: 'object', description: 'Parent folder' },
        modified_at: { type: 'string', description: 'Last modification timestamp' },
      },
    },
  },
}
