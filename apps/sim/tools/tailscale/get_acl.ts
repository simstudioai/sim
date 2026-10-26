import type { TailscaleGetAclParams, TailscaleGetAclResponse } from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleGetAclTool: ToolConfig<TailscaleGetAclParams, TailscaleGetAclResponse> = {
  id: 'tailscale_get_acl',
  name: 'Tailscale Get ACL',
  description: 'Get the tailnet policy file',
  version: '1.0.0',
  params: {
    details: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include the original HuJSON policy and its warnings and parsing errors',
    },
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
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/acl${params.details ? '?details=true' : ''}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      ...(params.details ? {} : { Accept: 'application/json' }),
    }),
  },
  transformResponse: async (response, params) => {
    await assertTailscaleResponse(response)
    const data: Record<string, unknown> & {
      acl?: string
      warnings?: string[] | null
      errors?: string[] | null
    } = await response.json()
    return {
      success: true,
      output: {
        acl: params?.details
          ? Buffer.from(data.acl ?? '', 'base64').toString('utf8')
          : JSON.stringify(data, null, 2),
        etag: response.headers.get('ETag') ?? '',
        warnings: params?.details ? (data.warnings ?? []) : [],
        errors: params?.details ? (data.errors ?? []) : [],
      },
    }
  },
  outputs: {
    warnings: { type: 'array', description: 'Policy warnings', items: { type: 'string' } },
    errors: { type: 'array', description: 'Policy parsing errors', items: { type: 'string' } },
    acl: {
      type: 'string',
      description: 'Tailnet policy as JSON, or the original HuJSON when diagnostics are enabled',
    },
    etag: {
      type: 'string',
      description: 'Policy ETag for conditional updates',
      optional: true,
    },
  },
}
