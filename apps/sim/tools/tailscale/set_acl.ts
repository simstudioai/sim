import type { ToolConfig, ToolResponse } from '@/tools/types'

interface TailscaleSetAclParams {
  apiKey: string
  tailnet: string
  acl: string
  ifMatch?: string
}

interface TailscaleSetAclResponse extends ToolResponse {
  output: {
    acl: string
    etag: string
  }
}

export const tailscaleSetAclTool: ToolConfig<TailscaleSetAclParams, TailscaleSetAclResponse> = {
  id: 'tailscale_set_acl',
  name: 'Tailscale Set ACL',
  description: 'Replace the ACL policy file for the tailnet',
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
    acl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The new ACL policy file, as a JSON string',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ETag from a prior Get ACL call to avoid overwriting concurrent updates. Use "ts-default" to only replace an untouched default policy file.',
    },
  },

  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(params.tailnet.trim())}/acl`,
    method: 'POST',
    headers: (params) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${params.apiKey.trim()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }
      if (params.ifMatch) headers['If-Match'] = `"${params.ifMatch.trim().replace(/^"|"$/g, '')}"`
      return headers
    },
    body: (params) => params.acl.trim(),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { acl: '', etag: '' },
        error: (data as Record<string, string>).message ?? 'Failed to set ACL',
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
    acl: { type: 'string', description: 'Updated ACL policy as JSON string' },
    etag: {
      type: 'string',
      description: 'ETag for the new ACL version (use with If-Match header for future updates)',
      optional: true,
    },
  },
}
