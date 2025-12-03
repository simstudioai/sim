import type { BoxSearchParams, BoxSearchResponse } from '@/tools/box/types'
import type { ToolConfig } from '@/tools/types'

export const boxSearchTool: ToolConfig<BoxSearchParams, BoxSearchResponse> = {
  id: 'box_search',
  name: 'Box Search',
  description: 'Search for files and folders in Box',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'box',
  },

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query string',
    },
    scope: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search scope: "user_content" (default) or "enterprise_content"',
    },
    fileExtensions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated file extensions to filter by (e.g., "pdf,docx")',
    },
    ancestorFolderIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated folder IDs to search within',
    },
    contentTypes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated content types: "name", "description", "file_content", "comments", "tag"',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (default: 30, max: 200)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset for pagination (default: 0)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('query', params.query)

      if (params.scope) {
        queryParams.append('scope', params.scope)
      }
      if (params.fileExtensions) {
        queryParams.append('file_extensions', params.fileExtensions)
      }
      if (params.ancestorFolderIds) {
        queryParams.append('ancestor_folder_ids', params.ancestorFolderIds)
      }
      if (params.contentTypes) {
        queryParams.append('content_types', params.contentTypes)
      }
      queryParams.append('limit', String(params.limit || 30))
      queryParams.append('offset', String(params.offset || 0))

      return `https://api.box.com/2.0/search?${queryParams.toString()}`
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
        error: data.message || data.error_description || 'Failed to search',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        results: data.entries || [],
        totalCount: data.total_count,
        offset: data.offset,
        limit: data.limit,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Array of search results',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Item ID' },
          type: { type: 'string', description: 'Item type' },
          name: { type: 'string', description: 'Item name' },
          parent: { type: 'object', description: 'Parent folder' },
          modified_at: { type: 'string', description: 'Last modification timestamp' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of search results',
    },
    offset: {
      type: 'number',
      description: 'Current offset',
    },
    limit: {
      type: 'number',
      description: 'Maximum results returned',
    },
  },
}
