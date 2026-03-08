import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XManageMuteParams, XManageMuteResponse } from '@/tools/x/types'

const logger = createLogger('XManageMuteTool')

export const xManageMuteTool: ToolConfig<XManageMuteParams, XManageMuteResponse> = {
  id: 'x_manage_mute',
  name: 'X Manage Mute',
  description: 'Mute or unmute a user on X',
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
      description: 'The user ID to mute or unmute',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Action to perform: "mute" or "unmute"',
    },
  },

  request: {
    url: (params) => {
      if (params.action === 'unmute') {
        return `https://api.x.com/2/users/${params.userId.trim()}/muting/${params.targetUserId.trim()}`
      }
      return `https://api.x.com/2/users/${params.userId.trim()}/muting`
    },
    method: (params) => (params.action === 'unmute' ? 'DELETE' : 'POST'),
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      if (params.action === 'unmute') return undefined
      return {
        target_user_id: params.targetUserId.trim(),
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.data) {
      logger.error('X Manage Mute API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.errors?.[0]?.detail || 'Failed to mute/unmute user',
        output: {
          muting: false,
        },
      }
    }

    return {
      success: true,
      output: {
        muting: data.data?.muting ?? false,
      },
    }
  },

  outputs: {
    muting: {
      type: 'boolean',
      description: 'Whether you are now muting the user',
    },
  },
}
