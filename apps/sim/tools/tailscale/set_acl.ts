import type { TailscaleSetAclParams, TailscaleSetAclResponse } from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleSetAclTool: ToolConfig<TailscaleSetAclParams, TailscaleSetAclResponse> = {
  id: 'tailscale_set_acl',
  name: 'Tailscale Set ACL',
  description: 'Replace the tailnet policy file',
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
    acl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Complete tailnet policy file in JSON or HuJSON',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ETag from Get ACL, or ts-default to replace only an untouched default policy',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/acl`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(params.ifMatch ? { 'If-Match': `"${params.ifMatch.trim().replace(/^"|"$/g, '')}"` } : {}),
    }),
    body: (params) => params.acl.trim(),
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: Record<string, unknown> = await response.json()
    return {
      success: true,
      output: { acl: JSON.stringify(data, null, 2), etag: response.headers.get('ETag') ?? '' },
    }
  },
  outputs: {
    acl: {
      type: 'string',
      description: 'Tailnet policy file as a JSON string',
    },
    etag: {
      type: 'string',
      description: 'Policy ETag for conditional updates',
      optional: true,
    },
  },
}
