import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonDeleteTag')

export interface PylonDeleteTagParams {
  apiToken: string
  tagId: string
}

export interface PylonDeleteTagResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'delete_tag'
      tagId: string
    }
    success: boolean
  }
}

export const pylonDeleteTagTool: ToolConfig<PylonDeleteTagParams, PylonDeleteTagResponse> = {
  id: 'pylon_delete_tag',
  name: 'Delete Tag in Pylon',
  description: 'Delete a specific tag by ID',
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
      description: 'Tag ID to delete',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/tags/${params.tagId}`),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'delete_tag')
    }

    return {
      success: true,
      output: {
        metadata: {
          operation: 'delete_tag' as const,
          tagId: '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Delete operation result',
      properties: {
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
