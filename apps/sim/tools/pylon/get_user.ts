import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonGetUser')

export interface PylonGetUserParams {
  apiToken: string
  userId: string
}

export interface PylonGetUserResponse {
  success: boolean
  output: {
    user: any
    metadata: {
      operation: 'get_user'
      userId: string
    }
    success: boolean
  }
}

export const pylonGetUserTool: ToolConfig<PylonGetUserParams, PylonGetUserResponse> = {
  id: 'pylon_get_user',
  name: 'Get User in Pylon',
  description: 'Retrieve a specific user by ID',
  version: '1.0.0',

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Pylon API token',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'User ID to retrieve',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/users/${params.userId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'get_user')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        user: data.data,
        metadata: {
          operation: 'get_user' as const,
          userId: data.data?.id || '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'User data',
      properties: {
        user: { type: 'object', description: 'User object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
