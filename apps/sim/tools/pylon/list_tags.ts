import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonListTags')

export interface PylonListTagsParams {
  apiToken: string
}

export interface PylonListTagsResponse {
  success: boolean
  output: {
    tags: any[]
    metadata: {
      operation: 'list_tags'
      totalReturned: number
    }
    success: boolean
  }
}

export const pylonListTagsTool: ToolConfig<PylonListTagsParams, PylonListTagsResponse> = {
  id: 'pylon_list_tags',
  name: 'List Tags in Pylon',
  description: 'Retrieve a list of tags',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
  },

  request: {
    url: () => buildPylonUrl('/tags'),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'list_tags')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        tags: data.data || [],
        metadata: {
          operation: 'list_tags' as const,
          totalReturned: data.data?.length || 0,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'List of tags',
      properties: {
        tags: { type: 'array', description: 'Array of tag objects' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
