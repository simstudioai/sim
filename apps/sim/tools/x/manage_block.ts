import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XManageBlockParams, XManageBlockResponse } from '@/tools/x/types'

const logger = createLogger('XManageBlockTool')

export const xManageBlockTool: ToolConfig<XManageBlockParams, XManageBlockResponse> = {
  id: 'x_manage_block',
  name: 'X Manage Block',
  description: 'Block or unblock a user on X',
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
      description: 'The user ID to block or unblock',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Action to perform: "block" or "unblock"',
    },
  },

  request: {
    url: (params) => {
      if (params.action === 'unblock') {
        return `https://api.x.com/2/users/${params.userId.trim()}/blocking/${params.targetUserId.trim()}`
      }
      return `https://api.x.com/2/users/${params.userId.trim()}/blocking`
    },
    method: (params) => (params.action === 'unblock' ? 'DELETE' : 'POST'),
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      if (params.action === 'unblock') return undefined
      return {
        target_user_id: params.targetUserId.trim(),
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.data) {
      logger.error('X Manage Block API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        output: {
          blocking: false,
        },
        error: data.errors?.[0]?.detail ?? 'Failed to manage block',
      }
    }

    return {
      success: true,
      output: {
        blocking: data.data?.blocking ?? false,
      },
    }
  },

  outputs: {
    blocking: {
      type: 'boolean',
      description: 'Whether you are now blocking the user',
    },
  },
}
