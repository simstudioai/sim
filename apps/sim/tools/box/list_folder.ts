import type { BoxListFolderItemsParams, BoxListFolderItemsResponse } from '@/tools/box/types'
import type { ToolConfig } from '@/tools/types'

export const boxListFolderTool: ToolConfig<BoxListFolderItemsParams, BoxListFolderItemsResponse> = {
  id: 'box_list_folder',
  name: 'Box List Folder',
  description: 'List items in a Box folder',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'box',
  },

  params: {
    folderId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the folder to list (use "0" for root folder)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of items to return (default: 100, max: 1000)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset for pagination (default: 0)',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of fields to include',
    },
  },

  request: {
    url: (params) => {
      const limit = params.limit || 100
      const offset = params.offset || 0
      const fields =
        params.fields || 'id,type,name,size,modified_at,created_at,parent,shared_link,description'
      return `https://api.box.com/2.0/folders/${params.folderId}/items?limit=${limit}&offset=${offset}&fields=${encodeURIComponent(fields)}`
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
        error: data.message || data.error_description || 'Failed to list folder',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        items: data.entries || [],
        totalCount: data.total_count,
        offset: data.offset,
        limit: data.limit,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Array of files and folders in the folder',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Item ID' },
          type: { type: 'string', description: 'Item type (file or folder)' },
          name: { type: 'string', description: 'Item name' },
          size: { type: 'number', description: 'Size in bytes (for files)' },
          modified_at: { type: 'string', description: 'Last modification timestamp' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of items in the folder',
    },
    offset: {
      type: 'number',
      description: 'Current offset for pagination',
    },
    limit: {
      type: 'number',
      description: 'Maximum items returned',
    },
  },
}
