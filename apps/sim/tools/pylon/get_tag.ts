import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonGetTag')

export interface PylonGetTagParams {
  apiToken: string
  tagId: string
}

export interface PylonGetTagResponse {
  success: boolean
  output: {
    tag: any
    metadata: {
      operation: 'get_tag'
      tagId: string
    }
    success: boolean
  }
}

export const pylonGetTagTool: ToolConfig<PylonGetTagParams, PylonGetTagResponse> = {
  id: 'pylon_get_tag',
  name: 'Get Tag in Pylon',
  description: 'Retrieve a specific tag by ID',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
    tagId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tag ID to retrieve',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/tags/${params.tagId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'get_tag')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        tag: data.data,
        metadata: {
          operation: 'get_tag' as const,
          tagId: data.data?.id || '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Tag data',
      properties: {
        tag: { type: 'object', description: 'Tag object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
