import { createLogger } from '@sim/logger'
import type { ClerkDeleteUserParams, ClerkDeleteUserResponse } from '@/tools/clerk/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ClerkDeleteUser')

export const clerkDeleteUserTool: ToolConfig<ClerkDeleteUserParams, ClerkDeleteUserResponse> = {
  id: 'clerk_delete_user',
  name: 'Delete User from Clerk',
  description: 'Delete a user from your Clerk application',
  version: '1.0.0',

  params: {
    secretKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The Clerk Secret Key for API authentication',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the user to delete',
    },
  },

  request: {
    url: (params) => `https://api.clerk.com/v1/users/${params.userId?.trim()}`,
    method: 'DELETE',
    headers: (params) => {
      if (!params.secretKey) {
        throw new Error('Clerk Secret Key is required')
      }
      return {
        Authorization: `Bearer ${params.secretKey}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('Clerk API request failed', { data, status: response.status })
      throw new Error(data.errors?.[0]?.message || 'Failed to delete user from Clerk')
    }

    return {
      success: true,
      output: {
        id: data.id,
        object: data.object ?? 'user',
        deleted: data.deleted ?? true,
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Deleted user ID' },
    object: { type: 'string', description: 'Object type (user)' },
    deleted: { type: 'boolean', description: 'Whether the user was deleted' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
