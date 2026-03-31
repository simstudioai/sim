import type { ToolConfig, ToolResponse } from '@/tools/types'
import type { TailscaleBaseParams } from './types'

interface TailscaleAuthKeyOutput {
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

interface TailscaleListAuthKeysResponse extends ToolResponse {
  output: {
    keys: TailscaleAuthKeyOutput[]
    count: number
  }
}

export const tailscaleListAuthKeysTool: ToolConfig<
  TailscaleBaseParams,
  TailscaleListAuthKeysResponse
> = {
  id: 'tailscale_list_auth_keys',
  name: 'Tailscale List Auth Keys',
  description: 'List all auth keys in the tailnet',
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
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(params.tailnet.trim())}/keys`,
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
        output: { keys: [], count: 0 },
        error: (data as Record<string, string>).message ?? 'Failed to list auth keys',
      }
    }

    const data = await response.json()
    const keys = (data.keys ?? []).map((key: Record<string, unknown>) => {
      const caps = (key.capabilities as Record<string, unknown>)?.devices as Record<string, unknown>
      const create = caps?.create as Record<string, unknown>
      return {
        id: (key.id as string) ?? null,
        description: (key.description as string) ?? null,
        created: (key.created as string) ?? null,
        expires: (key.expires as string) ?? null,
        revoked: (key.revoked as string) ?? null,
        capabilities: {
          reusable: (create?.reusable as boolean) ?? false,
          ephemeral: (create?.ephemeral as boolean) ?? false,
          preauthorized: (create?.preauthorized as boolean) ?? false,
          tags: (create?.tags as string[]) ?? [],
        },
      }
    })

    return {
      success: true,
      output: {
        keys,
        count: keys.length,
      },
    }
  },

  outputs: {
    keys: {
      type: 'array',
      description: 'List of auth keys',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Auth key ID' },
          description: { type: 'string', description: 'Key description' },
          created: { type: 'string', description: 'Creation timestamp' },
          expires: { type: 'string', description: 'Expiration timestamp' },
          revoked: { type: 'string', description: 'Revocation timestamp' },
          capabilities: {
            type: 'object',
            description: 'Key capabilities',
            properties: {
              reusable: { type: 'boolean', description: 'Whether the key is reusable' },
              ephemeral: { type: 'boolean', description: 'Whether devices are ephemeral' },
              preauthorized: { type: 'boolean', description: 'Whether devices are pre-authorized' },
              tags: { type: 'array', description: 'Tags applied to devices' },
            },
          },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Total number of auth keys',
    },
  },
}
