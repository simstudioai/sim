import type { ToolConfig, ToolResponse } from '@/tools/types'

interface TailscaleDeleteAuthKeyParams {
  apiKey: string
  tailnet: string
  keyId: string
}

interface TailscaleDeleteAuthKeyResponse extends ToolResponse {
  output: {
    success: boolean
    keyId: string
  }
}

export const tailscaleDeleteAuthKeyTool: ToolConfig<
  TailscaleDeleteAuthKeyParams,
  TailscaleDeleteAuthKeyResponse
> = {
  id: 'tailscale_delete_auth_key',
  name: 'Tailscale Delete Auth Key',
  description: 'Revoke and delete an auth key',
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
    keyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Auth key ID to delete',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(params.tailnet.trim())}/keys/${encodeURIComponent(params.keyId.trim())}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
    }),
  },

  transformResponse: async (response: Response, params?: TailscaleDeleteAuthKeyParams) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { success: false, keyId: '' },
        error: (data as Record<string, string>).message ?? 'Failed to delete auth key',
      }
    }

    return {
      success: true,
      output: {
        success: true,
        keyId: params?.keyId ?? '',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the auth key was successfully deleted' },
    keyId: { type: 'string', description: 'ID of the deleted auth key' },
  },
}
