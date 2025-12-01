import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildPylonUrl, handlePylonError } from './types'

const logger = createLogger('PylonUpdateUser')

export interface PylonUpdateUserParams {
  apiToken: string
  userId: string
  roleId?: string
  status?: string
}

export interface PylonUpdateUserResponse {
  success: boolean
  output: {
    user: any
    metadata: {
      operation: 'update_user'
      userId: string
    }
    success: boolean
  }
}

export const pylonUpdateUserTool: ToolConfig<PylonUpdateUserParams, PylonUpdateUserResponse> = {
  id: 'pylon_update_user',
  name: 'Update User in Pylon',
  description: 'Update an existing user with specified properties',
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
      description: 'User ID to update',
    },
    roleId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Role ID to assign to user',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'User status',
    },
  },

  request: {
    url: (params) => buildPylonUrl(`/users/${params.userId}`),
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: any = {}

      if (params.roleId) body.role_id = params.roleId
      if (params.status) body.status = params.status

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handlePylonError(data, response.status, 'update_user')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        user: data.data,
        metadata: {
          operation: 'update_user' as const,
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
      description: 'Updated user data',
      properties: {
        user: { type: 'object', description: 'Updated user object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
