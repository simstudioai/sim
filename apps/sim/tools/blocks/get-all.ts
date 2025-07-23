import type { ToolConfig, ToolResponse } from '../types'

interface GetAllBlocksParams {
  includeDetails?: boolean
  filterCategory?: string
}

interface GetAllBlocksResult {
  blockToToolsMapping: Record<string, string[]>
}

interface GetAllBlocksResponse extends ToolResponse {
  output: GetAllBlocksResult
}

export const getAllBlocksTool: ToolConfig<GetAllBlocksParams, GetAllBlocksResponse> = {
  id: 'get_blocks_and_tools',
  name: 'Get All Blocks and Tools',
  description:
    'Get a comprehensive list of all available blocks and tools in Sim Studio with their descriptions, categories, and capabilities',
  version: '1.0.0',

  params: {
    includeDetails: {
      type: 'boolean',
      required: false,
      description:
        'Whether to include detailed information like inputs, outputs, and sub-blocks (default: false)',
    },
    filterCategory: {
      type: 'string',
      required: false,
      description: 'Optional category filter for blocks (e.g., "tools", "blocks", "ai")',
    },
  },

  request: {
    url: '/api/tools/get-all-blocks',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      includeDetails: params.includeDetails || false,
      filterCategory: params.filterCategory,
    }),
    isInternalRoute: true,
  },

  transformResponse: async (
    response: Response,
    params?: GetAllBlocksParams
  ): Promise<GetAllBlocksResponse> => {
    if (!response.ok) {
      throw new Error(`Get all blocks failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || 'Failed to get blocks and tools')
    }

    return {
      success: true,
      output: {
        blockToToolsMapping: data.data,
      },
    }
  },

  transformError: (error: any): string => {
    if (error instanceof Error) {
      return `Failed to get blocks and tools: ${error.message}`
    }
    return 'An unexpected error occurred while getting blocks and tools'
  },
}
