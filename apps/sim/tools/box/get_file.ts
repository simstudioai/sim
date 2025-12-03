import type { BoxGetFileParams, BoxGetFileResponse } from '@/tools/box/types'
import type { ToolConfig } from '@/tools/types'

export const boxGetFileTool: ToolConfig<BoxGetFileParams, BoxGetFileResponse> = {
  id: 'box_get_file',
  name: 'Box Get File',
  description: 'Get information about a file in Box',
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
      description: 'The ID of the file to retrieve',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to include (e.g., "id,name,size,modified_at,shared_link")',
    },
  },

  request: {
    url: (params) => {
      const fields =
        params.fields ||
        'id,type,name,size,created_at,modified_at,created_by,modified_by,owned_by,parent,shared_link,description,path_collection'
      return `https://api.box.com/2.0/files/${params.fileId}?fields=${encodeURIComponent(fields)}`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Box API request')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message || data.error_description || 'Failed to get file',
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
      description: 'The file information',
      properties: {
        id: { type: 'string', description: 'File ID' },
        name: { type: 'string', description: 'File name' },
        size: { type: 'number', description: 'File size in bytes' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        modified_at: { type: 'string', description: 'Last modification timestamp' },
        parent: { type: 'object', description: 'Parent folder' },
        shared_link: { type: 'object', description: 'Shared link information if exists' },
      },
    },
  },
}
