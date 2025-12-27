import type { ToolConfig } from '@/tools/types'
import type { ListBoardsParams, ListBoardsResponse } from './types'

/**
 * Tool for listing Pinterest boards
 */
export const listBoardsTool: ToolConfig<ListBoardsParams, ListBoardsResponse> = {
  id: 'pinterest_list_boards',
  name: 'List Pinterest Boards',
  description: 'Get a list of all boards for the authenticated Pinterest user',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'pinterest',
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pinterest OAuth access token',
    },
  },
  request: {
    url: 'https://api.pinterest.com/v5/boards',
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },
  transformResponse: async (response: Response): Promise<ListBoardsResponse> => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        output: {},
        error: `Pinterest API error: ${response.status} - ${errorText}`,
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: {
        boards: data.items || [],
      },
    }
  },
}
