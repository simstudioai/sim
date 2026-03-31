import type { ToolConfig, ToolResponse } from '@/tools/types'
import type { TailscaleBaseParams } from './types'

interface TailscaleGetAclResponse extends ToolResponse {
  output: {
    acl: string
    etag: string
  }
}

export const tailscaleGetAclTool: ToolConfig<TailscaleBaseParams, TailscaleGetAclResponse> = {
  id: 'tailscale_get_acl',
  name: 'Tailscale Get ACL',
  description: 'Get the current ACL policy for the tailnet',
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
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(params.tailnet.trim())}/acl`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { acl: '', etag: '' },
        error: (data as Record<string, string>).message ?? 'Failed to get ACL',
      }
    }

    const etag = response.headers.get('ETag') ?? ''
    const data = await response.json()

    return {
      success: true,
      output: {
        acl: JSON.stringify(data, null, 2),
        etag,
      },
    }
  },

  outputs: {
    acl: { type: 'string', description: 'ACL policy as JSON string' },
    etag: {
      type: 'string',
      description: 'ETag for the current ACL version (use with If-Match header for updates)',
      optional: true,
    },
  },
}
