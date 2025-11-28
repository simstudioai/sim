import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonUpdateTag')

export interface PylonUpdateTagParams {
  apiToken: string
  tagId: string
  hexColor?: string
  value?: string
}

export interface PylonUpdateTagResponse {
  success: boolean
  output: {
    tag: any
    metadata: {
      operation: 'update_tag'
      tagId: string
    }
    success: boolean
  }
}

export const pylonUpdateTagTool: ToolConfig<PylonUpdateTagParams, PylonUpdateTagResponse> = {
  id: 'pylon_update_tag',
  name: 'Update Tag in Pylon',
  description: 'Update an existing tag with specified properties',
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
      description: 'Tag ID to update',
    },
    hexColor: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Hex color code for tag (e.g., #FF5733)',
    },
    value: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Tag value/name',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/tags/${params.tagId}`),
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: any = {}

      if (params.hexColor) body.hex_color = params.hexColor
      if (params.value) body.value = params.value

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'update_tag')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        tag: data.data,
        metadata: {
          operation: 'update_tag' as const,
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
      description: 'Updated tag data',
      properties: {
        tag: { type: 'object', description: 'Updated tag object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
