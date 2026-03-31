import type { ToolConfig, ToolResponse } from '@/tools/types'

interface TailscaleGetAuthKeyParams {
  apiKey: string
  tailnet: string
  keyId: string
}

interface TailscaleGetAuthKeyResponse extends ToolResponse {
  output: {
    id: string
    description: string
    created: string
    expires: string
    revoked: string
    capabilities: {
      reusable: boolean
      ephemeral: boolean
      preauthorized: boolean
      tags: string[]
    }
  }
}

export const tailscaleGetAuthKeyTool: ToolConfig<
  TailscaleGetAuthKeyParams,
  TailscaleGetAuthKeyResponse
> = {
  id: 'tailscale_get_auth_key',
  name: 'Tailscale Get Auth Key',
  description: 'Get details of a specific auth key',
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
      description: 'Auth key ID',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(params.tailnet.trim())}/keys/${encodeURIComponent(params.keyId.trim())}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        output: {
          id: '',
          description: '',
          created: '',
          expires: '',
          revoked: '',
          capabilities: { reusable: false, ephemeral: false, preauthorized: false, tags: [] },
        },
        error: (data as Record<string, string>).message ?? 'Failed to get auth key',
      }
    }

    const data = await response.json()
    const deviceCaps = data.capabilities?.devices?.create ?? {}

    return {
      success: true,
      output: {
        id: data.id ?? null,
        description: data.description ?? null,
        created: data.created ?? null,
        expires: data.expires ?? null,
        revoked: data.revoked ?? null,
        capabilities: {
          reusable: deviceCaps.reusable ?? false,
          ephemeral: deviceCaps.ephemeral ?? false,
          preauthorized: deviceCaps.preauthorized ?? false,
          tags: deviceCaps.tags ?? [],
        },
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Auth key ID' },
    description: { type: 'string', description: 'Key description', optional: true },
    created: { type: 'string', description: 'Creation timestamp' },
    expires: { type: 'string', description: 'Expiration timestamp' },
    revoked: { type: 'string', description: 'Revocation timestamp', optional: true },
    capabilities: {
      type: 'object',
      description: 'Key capabilities',
      properties: {
        reusable: { type: 'boolean', description: 'Whether the key is reusable' },
        ephemeral: { type: 'boolean', description: 'Whether devices are ephemeral' },
        preauthorized: { type: 'boolean', description: 'Whether devices are pre-authorized' },
        tags: { type: 'array', description: 'Tags applied to devices using this key' },
      },
    },
  },
}
