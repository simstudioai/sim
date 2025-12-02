import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonCreateTag')

export interface PylonCreateTagParams {
  apiToken: string
  objectType: string
  value: string
  hexColor?: string
}

export interface PylonCreateTagResponse {
  success: boolean
  output: {
    tag: any
    metadata: {
      operation: 'create_tag'
      tagId: string
    }
    success: boolean
  }
}

export const pylonCreateTagTool: ToolConfig<PylonCreateTagParams, PylonCreateTagResponse> = {
  id: 'pylon_create_tag',
  name: 'Create Tag in Pylon',
  description: 'Create a new tag with specified properties (objectType: account/issue/contact)',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
    objectType: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Object type for tag (account, issue, or contact)',
    },
    value: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tag value/name',
    },
    hexColor: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Hex color code for tag (e.g., #FF5733)',
    },
  },

  request: {
    url: () => buildPylonUrl('/tags'),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: any = {
        object_type: params.objectType,
        value: params.value,
      }

      if (params.hexColor) body.hex_color = params.hexColor

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'create_tag')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        tag: data.data,
        metadata: {
          operation: 'create_tag' as const,
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
      description: 'Created tag data',
      properties: {
        tag: { type: 'object', description: 'Created tag object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
