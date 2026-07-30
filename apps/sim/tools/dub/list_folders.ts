import type { DubListFoldersParams, DubListFoldersResponse } from '@/tools/dub/types'
import type { ToolConfig } from '@/tools/types'

export const listFoldersTool: ToolConfig<DubListFoldersParams, DubListFoldersResponse> = {
  id: 'dub_list_folders',
  name: 'Dub List Folders',
  description:
    'Retrieve the folders defined in the workspace, so the right folder ID can be used to organize links.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dub API key',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search by folder name',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (default: 1)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of folders per page (default: 50, max: 50)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.dub.co/folders')
      if (params.search) url.searchParams.set('search', params.search)
      if (params.page) url.searchParams.set('page', String(params.page))
      if (params.pageSize) url.searchParams.set('pageSize', String(params.pageSize))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.error || 'Failed to list folders')
    }

    const folders = Array.isArray(data) ? (data as Record<string, unknown>[]) : []

    return {
      success: true,
      output: {
        folders,
        count: folders.length,
      },
    }
  },

  outputs: {
    folders: {
      type: 'json',
      description: 'Array of folder objects (id, name, accessLevel)',
    },
    count: { type: 'number', description: 'Number of folders returned' },
  },
}
