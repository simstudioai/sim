import type { GranolaListFoldersParams, GranolaListFoldersResponse } from '@/tools/granola/types'
import type { ToolConfig } from '@/tools/types'

export const listFoldersTool: ToolConfig<GranolaListFoldersParams, GranolaListFoldersResponse> = {
  id: 'granola_list_folders',
  name: 'Granola List Folders',
  description: 'Lists folders from Granola, sorted alphabetically, with pagination.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Granola API key',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of folders per page (1-30, default 10)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://public-api.granola.ai/v1/folders')
      if (params.cursor) url.searchParams.append('cursor', params.cursor)
      if (params.pageSize) url.searchParams.append('page_size', String(params.pageSize))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Granola API error (${response.status}): ${error}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        folders: (data.folders ?? []).map(
          (folder: { id: string; name: string; parent_folder_id: string | null }) => ({
            id: folder.id,
            name: folder.name ?? '',
            parentFolderId: folder.parent_folder_id ?? null,
          })
        ),
        hasMore: data.hasMore ?? false,
        cursor: data.cursor ?? null,
      },
    }
  },

  outputs: {
    folders: {
      type: 'json',
      description: 'List of folders',
      properties: {
        id: { type: 'string', description: 'Folder ID' },
        name: { type: 'string', description: 'Folder name' },
        parentFolderId: {
          type: 'string',
          description: 'Parent folder ID, or null for top-level folders',
          optional: true,
        },
      },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more folders are available',
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for the next page',
      optional: true,
    },
  },
}
