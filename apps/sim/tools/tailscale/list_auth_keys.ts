import { KEY_OUTPUT_PROPERTIES } from '@/tools/tailscale/outputs'
import type {
  TailscaleKey,
  TailscaleListAuthKeysParams,
  TailscaleListAuthKeysResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse, mapTailscaleKey } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleListAuthKeysTool: ToolConfig<
  TailscaleListAuthKeysParams,
  TailscaleListAuthKeysResponse
> = {
  id: 'tailscale_list_auth_keys',
  name: 'Tailscale List Keys',
  description: 'List active auth keys, API access tokens, and trust credentials in the tailnet',
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
    all: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Include all tailnet keys (default true); false restricts keys according to the access token owner',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/keys?all=${params.all ?? true}`,
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey.trim()}` }),
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: { keys?: TailscaleKey[] } = await response.json()
    const keys = (data.keys ?? []).map(mapTailscaleKey)
    return { success: true, output: { keys, count: keys.length } }
  },
  outputs: {
    keys: {
      type: 'array',
      description: 'Keys in the tailnet',
      items: { type: 'object', properties: KEY_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of returned items' },
  },
}
