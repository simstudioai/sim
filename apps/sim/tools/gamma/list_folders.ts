import type { GammaListFoldersParams, GammaListFoldersResponse } from '@/tools/gamma/types'
import type { ToolConfig } from '@/tools/types'

export const listFoldersTool: ToolConfig<GammaListFoldersParams, GammaListFoldersResponse> = {
  id: 'gamma_list_folders',
  name: 'Gamma List Folders',
  description:
    'List available folders in your Gamma workspace. Returns folder IDs and names for organizing generated content.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gamma API key',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query to filter folders by name (case-sensitive)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of folders to return per page (max 50)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response (nextCursor) to fetch the next page',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://public-api.gamma.app/v1.0/folders')
      if (params.query) url.searchParams.append('query', params.query)
      if (params.limit) url.searchParams.append('limit', String(params.limit))
      if (params.after) url.searchParams.append('after', params.after)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'X-API-KEY': params.apiKey,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const items = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : []

    return {
      success: true,
      output: {
        folders: items.map((folder: { id?: string; name?: string }) => ({
          id: folder.id ?? '',
          name: folder.name ?? '',
        })),
        hasMore: data.hasMore ?? false,
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    folders: {
      type: 'array',
      description: 'List of available folders',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Folder ID (use with folderIds parameter)' },
          name: { type: 'string', description: 'Folder display name' },
        },
      },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more results are available on the next page',
    },
    nextCursor: {
      type: 'string',
      description: 'Pagination cursor to pass as the after parameter for the next page',
      optional: true,
    },
  },
}
