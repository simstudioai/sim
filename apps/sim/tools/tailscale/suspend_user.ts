import type { ToolConfig, ToolResponse } from '@/tools/types'
import type { TailscaleBaseParams } from './types'

interface TailscaleSuspendUserParams extends TailscaleBaseParams {
  userId: string
}

interface TailscaleSuspendUserResponse extends ToolResponse {
  output: {
    success: boolean
    userId: string
  }
}

export const tailscaleSuspendUserTool: ToolConfig<
  TailscaleSuspendUserParams,
  TailscaleSuspendUserResponse
> = {
  id: 'tailscale_suspend_user',
  name: 'Tailscale Suspend User',
  description: "Suspend a user's access to the tailnet",
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
      description: 'User ID to suspend',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/users/${encodeURIComponent(params.userId.trim())}/suspend`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
    }),
  },

  transformResponse: async (response: Response, params?: TailscaleSuspendUserParams) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { success: false, userId: '' },
        error: (data as Record<string, string>).message ?? 'Failed to suspend user',
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
    success: { type: 'boolean', description: 'Whether the user was successfully suspended' },
    userId: { type: 'string', description: 'ID of the suspended user' },
  },
}
