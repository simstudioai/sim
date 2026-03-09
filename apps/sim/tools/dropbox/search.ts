import type { DropboxSearchParams, DropboxSearchResponse } from '@/tools/dropbox/types'
import type { ToolConfig } from '@/tools/types'

export const dropboxSearchTool: ToolConfig<DropboxSearchParams, DropboxSearchResponse> = {
  id: 'dropbox_search',
  name: 'Dropbox Search',
  description: 'Search for files and folders in Dropbox',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'dropbox',
  },

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query',
    },
    path: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Dropbox folder path to limit search scope (e.g., /folder/subfolder)',
    },
    fileExtensions: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of file extensions to filter by (e.g., pdf,xlsx)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (default: 100)',
    },
  },

  request: {
    url: 'https://api.dropboxapi.com/2/files/search_v2',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Dropbox API request')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const body: Record<string, any> = {
        query: params.query,
      }

      const options: Record<string, any> = {}

      if (params.path) {
        options.path = params.path
      }

      if (params.fileExtensions) {
        const extensions = params.fileExtensions
          .split(',')
          .map((ext) => ext.trim())
          .filter((ext) => ext.length > 0)
        if (extensions.length > 0) {
          options.file_extensions = extensions
        }
      }

      if (params.maxResults) {
        options.max_results = params.maxResults
      }

      if (Object.keys(options).length > 0) {
        body.options = options
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error_summary || data.error?.message || 'Failed to search files',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        matches: data.matches || [],
        hasMore: data.has_more || false,
        cursor: data.cursor,
      },
    }
  },

  outputs: {
    matches: {
      type: 'array',
      description: 'Search results',
      items: {
        type: 'object',
        properties: {
          match_type: {
            type: 'object',
            description: 'Type of match: filename, content, or both',
          },
          metadata: {
            type: 'object',
            description: 'File or folder metadata',
          },
        },
      },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether there are more results',
    },
    cursor: {
      type: 'string',
      description: 'Cursor for pagination',
    },
  },
}
