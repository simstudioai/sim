import type { BoxGetCurrentUserParams, BoxGetCurrentUserResponse } from '@/tools/box/types'
import type { ToolConfig } from '@/tools/types'

export const boxGetCurrentUserTool: ToolConfig<BoxGetCurrentUserParams, BoxGetCurrentUserResponse> =
  {
    id: 'box_get_current_user',
    name: 'Box Get Current User',
    description: 'Get information about the authenticated Box user',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'box',
    },

    params: {},

    request: {
      url: 'https://api.box.com/2.0/users/me',
      method: 'GET',
      headers: (params) => {
        if (!params.accessToken) {
          throw new Error('Missing access token for Box API request')
        }
        return {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
        }
      },
    },

    transformResponse: async (response) => {
      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          error: data.message || data.error_description || 'Failed to get current user',
          output: {},
        }
      }

      return {
        success: true,
        output: {
          user: {
            id: data.id,
            type: data.type,
            name: data.name,
            login: data.login,
            avatar_url: data.avatar_url,
            space_used: data.space_used,
            space_amount: data.space_amount,
            max_upload_size: data.max_upload_size,
          },
        },
      }
    },

    outputs: {
      user: {
        type: 'object',
        description: 'The authenticated user',
        properties: {
          id: { type: 'string', description: 'User ID' },
          name: { type: 'string', description: 'User name' },
          login: { type: 'string', description: 'User email/login' },
          avatar_url: { type: 'string', description: 'Avatar URL' },
          space_used: { type: 'number', description: 'Space used in bytes' },
          space_amount: { type: 'number', description: 'Total space available in bytes' },
          max_upload_size: { type: 'number', description: 'Maximum upload size in bytes' },
        },
      },
    },
  }
