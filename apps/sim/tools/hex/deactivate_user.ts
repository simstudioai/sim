import type { HexDeactivateUserParams, HexDeactivateUserResponse } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const deactivateUserTool: ToolConfig<HexDeactivateUserParams, HexDeactivateUserResponse> = {
  id: 'hex_deactivate_user',
  name: 'Hex Deactivate User',
  description: 'Deactivate a user in the Hex workspace.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hex API token (Personal or Workspace)',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the user to deactivate',
    },
  },

  request: {
    url: (params) => `https://app.hex.tech/api/v1/users/${params.userId.trim()}/deactivate`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    if (response.status === 204 || response.ok) {
      return {
        success: true,
        output: {
          success: true,
          userId: params?.userId ?? '',
        },
      }
    }

    const data = await response.json().catch(() => ({}))
    return {
      success: false,
      output: {
        success: false,
        userId: params?.userId ?? '',
      },
      error: (data as Record<string, string>).message ?? 'Failed to deactivate user',
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the user was successfully deactivated' },
    userId: { type: 'string', description: 'User UUID that was deactivated' },
  },
}
