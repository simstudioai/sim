import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XManageFollowParams, XManageFollowResponse } from '@/tools/x/types'

const logger = createLogger('XManageFollowTool')

export const xManageFollowTool: ToolConfig<XManageFollowParams, XManageFollowResponse> = {
  id: 'x_manage_follow',
  name: 'X Manage Follow',
  description: 'Follow or unfollow a user on X',
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
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The authenticated user ID',
    },
    targetUserId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user ID to follow or unfollow',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Action to perform: "follow" or "unfollow"',
    },
  },

  request: {
    url: (params) => {
      if (params.action === 'unfollow') {
        return `https://api.x.com/2/users/${params.userId.trim()}/following/${params.targetUserId.trim()}`
      }
      return `https://api.x.com/2/users/${params.userId.trim()}/following`
    },
    method: (params) => (params.action === 'unfollow' ? 'DELETE' : 'POST'),
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      if (params.action === 'unfollow') return undefined
      return {
        target_user_id: params.targetUserId.trim(),
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.data) {
      logger.error('X Manage Follow API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        output: {
          following: false,
          pendingFollow: false,
        },
        error: data.errors?.[0]?.detail ?? 'Failed to manage follow',
      }
    }

    return {
      success: true,
      output: {
        following: data.data?.following ?? false,
        pendingFollow: data.data?.pending_follow ?? false,
      },
    }
  },

  outputs: {
    following: {
      type: 'boolean',
      description: 'Whether you are now following the user',
    },
    pendingFollow: {
      type: 'boolean',
      description: 'Whether the follow request is pending (for protected accounts)',
    },
  },
}
