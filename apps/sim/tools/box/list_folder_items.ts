import type { ToolConfig } from '@/tools/types'
import type { BoxFolderItemsResponse, BoxListFolderItemsParams } from './types'
import { FOLDER_ITEMS_OUTPUT_PROPERTIES } from './types'

export const boxListFolderItemsTool: ToolConfig<BoxListFolderItemsParams, BoxFolderItemsResponse> =
  {
    id: 'box_list_folder_items',
    name: 'Box List Folder Items',
    description: 'List files and folders in a Box folder',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'box',
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'OAuth access token for Box API',
      },
      folderId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The ID of the folder to list items from (use "0" for root)',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of items to return per page',
      },
      offset: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'The offset for pagination',
      },
      sort: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Sort field: id, name, date, or size',
      },
      direction: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Sort direction: ASC or DESC',
      },
    },

    request: {
      url: (params) => {
        const queryParams = new URLSearchParams()
        if (params.limit !== undefined) queryParams.set('limit', String(params.limit))
        if (params.offset !== undefined) queryParams.set('offset', String(params.offset))
        if (params.sort) queryParams.set('sort', params.sort)
        if (params.direction) queryParams.set('direction', params.direction)
        const qs = queryParams.toString()
        return `https://api.box.com/2.0/folders/${params.folderId.trim()}/items${qs ? `?${qs}` : ''}`
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
      }),
    },

    transformResponse: async (response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || `Box API error: ${response.status}`)
      }

      return {
        success: true,
        output: {
          entries: (data.entries ?? []).map((item: Record<string, unknown>) => ({
            type: item.type ?? '',
            id: item.id ?? '',
            name: item.name ?? '',
            size: item.size ?? null,
            createdAt: item.created_at ?? null,
            modifiedAt: item.modified_at ?? null,
          })),
          totalCount: data.total_count ?? 0,
          offset: data.offset ?? 0,
          limit: data.limit ?? 0,
        },
      }
    },

    outputs: FOLDER_ITEMS_OUTPUT_PROPERTIES,
  }
