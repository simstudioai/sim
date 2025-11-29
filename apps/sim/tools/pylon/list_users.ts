import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonListUsers')

export interface PylonListUsersParams {
  apiToken: string
}

export interface PylonListUsersResponse {
  success: boolean
  output: {
    users: any[]
    metadata: {
      operation: 'list_users'
      totalReturned: number
    }
    success: boolean
  }
}

export const pylonListUsersTool: ToolConfig<PylonListUsersParams, PylonListUsersResponse> = {
  id: 'pylon_list_users',
  name: 'List Users in Pylon',
  description: 'Retrieve a list of users',
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
    url: () => buildPylonUrl('/users'),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'list_users')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        users: data.data || [],
        metadata: {
          operation: 'list_users' as const,
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
      description: 'List of users',
      properties: {
        users: { type: 'array', description: 'Array of user objects' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
