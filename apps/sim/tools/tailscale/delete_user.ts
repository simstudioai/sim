import type { ToolConfig, ToolResponse } from '@/tools/types'
import type { TailscaleBaseParams } from './types'

interface TailscaleDeleteUserParams extends TailscaleBaseParams {
  userId: string
}

interface TailscaleDeleteUserResponse extends ToolResponse {
  output: {
    success: boolean
    userId: string
  }
}

export const tailscaleDeleteUserTool: ToolConfig<
  TailscaleDeleteUserParams,
  TailscaleDeleteUserResponse
> = {
  id: 'tailscale_delete_user',
  name: 'Tailscale Delete User',
  description: 'Delete a user from the tailnet',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Tailscale API key',
    },
    tailnet: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tailnet name (e.g., example.com) or "-" for default',
    },
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID to delete',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/users/${encodeURIComponent(params.userId.trim())}/delete`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
    }),
  },

  transformResponse: async (response: Response, params?: TailscaleDeleteUserParams) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { success: false, userId: '' },
        error: (data as Record<string, string>).message ?? 'Failed to delete user',
      }
    }

    return {
      success: true,
      output: {
        success: true,
        userId: params?.userId ?? '',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the user was successfully deleted' },
    userId: { type: 'string', description: 'ID of the deleted user' },
  },
}
