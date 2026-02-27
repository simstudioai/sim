import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XGetMeParams, XGetMeResponse } from '@/tools/x/types'
import { transformUser } from '@/tools/x/types'

const logger = createLogger('XGetMeTool')

export const xGetMeTool: ToolConfig<XGetMeParams, XGetMeResponse> = {
  id: 'x_get_me',
  name: 'X Get Me',
  description: "Get the authenticated user's profile information",
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'x',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'X OAuth access token',
    },
  },

  request: {
    url: () => {
      const queryParams = new URLSearchParams({
        'user.fields':
          'created_at,description,profile_image_url,verified,public_metrics,location,url',
      })
      return `https://api.x.com/2/users/me?${queryParams.toString()}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.data) {
      logger.error('X Get Me API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.errors?.[0]?.detail || 'Failed to get authenticated user info',
        output: {
          user: {} as XGetMeResponse['output']['user'],
        },
      }
    }

    return {
      success: true,
      output: {
        user: transformUser(data.data),
      },
    }
  },

  outputs: {
    user: {
      type: 'object',
      description: 'Authenticated user profile',
      properties: {
        id: { type: 'string', description: 'User ID' },
        username: { type: 'string', description: 'Username without @ symbol' },
        name: { type: 'string', description: 'Display name' },
        description: { type: 'string', description: 'User bio', optional: true },
        profileImageUrl: { type: 'string', description: 'Profile image URL', optional: true },
        verified: { type: 'boolean', description: 'Whether the user is verified' },
        metrics: {
          type: 'object',
          description: 'User statistics',
          properties: {
            followersCount: { type: 'number', description: 'Number of followers' },
            followingCount: { type: 'number', description: 'Number of users following' },
            tweetCount: { type: 'number', description: 'Total number of tweets' },
          },
        },
      },
    },
  },
}
