import type { GranolaListFoldersParams, GranolaListFoldersResponse } from '@/tools/granola/types'
import { GRANOLA_API_BASE, granolaHeaders, throwGranolaError } from '@/tools/granola/utils'
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
      const url = new URL(`${GRANOLA_API_BASE}/folders`)
      if (params.cursor) url.searchParams.append('cursor', params.cursor)
      if (params.pageSize) url.searchParams.append('page_size', String(params.pageSize))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => granolaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwGranolaError(response)

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
      type: 'array',
      description: 'List of folders',
      items: {
        type: 'object',
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
