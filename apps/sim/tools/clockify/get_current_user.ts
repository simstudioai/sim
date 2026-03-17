import type { ClockifyGetCurrentUserParams, ClockifyGetCurrentUserResponse } from '@/tools/clockify/types'
import type { ToolConfig } from '@/tools/types'

export const clockifyGetCurrentUserTool: ToolConfig<
  ClockifyGetCurrentUserParams,
  ClockifyGetCurrentUserResponse
> = {
  id: 'clockify_get_current_user',
  name: 'Clockify Get Current User',
  description: 'Get the currently authenticated Clockify user profile',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Clockify API key',
    },
  },

  request: {
    url: 'https://api.clockify.me/api/v1/user',
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to get current user')
    }

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'User ID',
    },
    name: {
      type: 'string',
      description: 'User name',
    },
    email: {
      type: 'string',
      description: 'User email address',
    },
    status: {
      type: 'string',
      description: 'User status',
    },
    profilePicture: {
      type: 'string',
      description: 'URL to the user profile picture',
    },
    activeWorkspace: {
      type: 'string',
      description: 'ID of the active workspace',
    },
    defaultWorkspace: {
      type: 'string',
      description: 'ID of the default workspace',
    },
  },
}
