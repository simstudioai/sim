import type { ClockifyGetUsersParams, ClockifyGetUsersResponse } from '@/tools/clockify/types'
import type { ToolConfig } from '@/tools/types'

export const clockifyGetUsersTool: ToolConfig<
  ClockifyGetUsersParams,
  ClockifyGetUsersResponse
> = {
  id: 'clockify_get_users',
  name: 'Clockify Get Workspace Users',
  description: 'Get all users in a Clockify workspace',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Clockify API key',
    },
    workspaceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Workspace ID to get users from',
    },
  },

  request: {
    url: (params) => `https://api.clockify.me/api/v1/workspaces/${params.workspaceId}/users`,
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to get workspace users')
    }

    return {
      success: true,
      output: {
        users: data,
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'Array of user objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'User ID' },
          name: { type: 'string', description: 'User name' },
          email: { type: 'string', description: 'User email address' },
          status: { type: 'string', description: 'User status' },
        },
      },
    },
  },
}
