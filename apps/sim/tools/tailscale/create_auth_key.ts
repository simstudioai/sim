import { KEY_OUTPUT_PROPERTIES } from '@/tools/tailscale/outputs'
import type {
  TailscaleCreateAuthKeyParams,
  TailscaleCreateAuthKeyResponse,
  TailscaleKey,
} from '@/tools/tailscale/types'
import {
  assertTailscaleResponse,
  mapTailscaleKey,
  parseTailscaleList,
} from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleCreateAuthKeyTool: ToolConfig<
  TailscaleCreateAuthKeyParams,
  TailscaleCreateAuthKeyResponse
> = {
  id: 'tailscale_create_auth_key',
  name: 'Tailscale Create Auth Key',
  description: 'Create a device enrollment auth key',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Tailscale API access token or OAuth access token (not an auth key or OAuth client secret)',
    },
    tailnet: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tailnet ID, legacy name, or "-" for the token’s default tailnet',
    },
    reusable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the auth key can register multiple devices (default false)',
    },
    ephemeral: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether devices registered with the key are ephemeral (default false)',
    },
    preauthorized: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether devices skip manual approval (default true)',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tags; required when creating a tailnet-owned key using OAuth',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Auth key description, up to 50 alphanumeric characters, spaces, or hyphens',
    },
    expirySeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Auth key lifetime in seconds (default 7776000, 90 days)',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/keys`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      capabilities: {
        devices: {
          create: {
            reusable: params.reusable ?? false,
            ephemeral: params.ephemeral ?? false,
            preauthorized: params.preauthorized ?? true,
            ...(params.tags?.trim() ? { tags: parseTailscaleList(params.tags) } : {}),
          },
        },
      },
      ...(params.description ? { description: params.description } : {}),
      ...(params.expirySeconds != null ? { expirySeconds: params.expirySeconds } : {}),
    }),
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: TailscaleKey = await response.json()
    return { success: true, output: { ...mapTailscaleKey(data), key: data.key ?? null } }
  },
  outputs: {
    ...KEY_OUTPUT_PROPERTIES,
    key: {
      type: 'string',
      description: 'Auth key secret, returned only at creation',
      nullable: true,
    },
  },
}
