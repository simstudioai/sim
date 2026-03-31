import type { ToolConfig } from '@/tools/types'
import type { TailscaleCreateAuthKeyParams, TailscaleCreateAuthKeyResponse } from './types'

export const tailscaleCreateAuthKeyTool: ToolConfig<
  TailscaleCreateAuthKeyParams,
  TailscaleCreateAuthKeyResponse
> = {
  id: 'tailscale_create_auth_key',
  name: 'Tailscale Create Auth Key',
  description: 'Create a new auth key for the tailnet to pre-authorize devices',
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
    reusable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the key can be used more than once',
      default: false,
    },
    ephemeral: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether devices authenticated with this key are ephemeral',
      default: false,
    },
    preauthorized: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether devices are pre-authorized (skip manual approval)',
      default: true,
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of tags for devices using this key (e.g., "tag:server,tag:prod")',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description for the auth key',
    },
    expirySeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Key expiry time in seconds (default: 90 days)',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(params.tailnet.trim())}/keys`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const tags = params.tags
        ? params.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : []

      const createCaps: Record<string, unknown> = {
        reusable: params.reusable ?? false,
        ephemeral: params.ephemeral ?? false,
        preauthorized: params.preauthorized ?? true,
      }

      if (tags.length > 0) {
        createCaps.tags = tags
      }

      const body: Record<string, unknown> = {
        capabilities: {
          devices: {
            create: createCaps,
          },
        },
      }

      if (params.description) body.description = params.description
      if (params.expirySeconds !== undefined && params.expirySeconds !== null)
        body.expirySeconds = params.expirySeconds

      return body
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        output: {
          id: '',
          key: '',
          description: '',
          created: '',
          expires: '',
          revoked: '',
          capabilities: { reusable: false, ephemeral: false, preauthorized: false, tags: [] },
        },
        error: (data as Record<string, string>).message ?? 'Failed to create auth key',
      }
    }

    const data = await response.json()
    const deviceCaps = data.capabilities?.devices?.create ?? {}

    return {
      success: true,
      output: {
        id: data.id ?? null,
        key: data.key ?? null,
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
    key: { type: 'string', description: 'The auth key value (only shown once at creation)' },
    description: { type: 'string', description: 'Key description', optional: true },
    created: { type: 'string', description: 'Creation timestamp' },
    expires: { type: 'string', description: 'Expiration timestamp' },
    revoked: {
      type: 'string',
      description: 'Revocation timestamp (empty if not revoked)',
      optional: true,
    },
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
