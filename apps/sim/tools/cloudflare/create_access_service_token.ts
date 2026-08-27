import type {
  CloudflareCreateAccessServiceTokenParams,
  CloudflareCreateAccessServiceTokenResponse,
} from '@/tools/cloudflare/types'
import { cloudflareErrorMessage, cloudflareHeaders } from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const createAccessServiceTokenTool: ToolConfig<
  CloudflareCreateAccessServiceTokenParams,
  CloudflareCreateAccessServiceTokenResponse
> = {
  id: 'cloudflare_create_access_service_token',
  name: 'Cloudflare Create Access Service Token',
  description:
    'Creates a Cloudflare Access (Zero Trust) service token so a machine can authenticate to Access-protected applications. This is the only response that ever contains the client secret — Cloudflare will not return it again, so capture it in the same run. Requires an API token with Account Access: Service Tokens Edit.',
  version: '1.0.0',

  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. Service tokens are account-scoped',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the service token',
    },
    duration: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "How long the token stays valid before it expires, e.g. 8760h. Defaults to Cloudflare's standard lifetime",
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/accounts/${params.accountId.trim()}/access/service_tokens`,
    method: 'POST',
    headers: (params) => cloudflareHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = { name: params.name }
      if (params.duration) body.duration = params.duration
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          id: '',
          name: null,
          client_id: null,
          client_secret: null,
          duration: null,
          enabled: null,
          expires_at: null,
          last_seen_at: null,
          created_at: null,
          updated_at: null,
        },
        error: cloudflareErrorMessage(data, 'Failed to create Access service token'),
      }
    }

    const token = data.result
    return {
      success: true,
      output: {
        id: token?.id ?? '',
        name: token?.name ?? null,
        client_id: token?.client_id ?? null,
        client_secret: token?.client_secret ?? null,
        duration: token?.duration ?? null,
        enabled: token?.enabled ?? null,
        expires_at: token?.expires_at ?? null,
        last_seen_at: token?.last_seen_at ?? null,
        created_at: token?.created_at ?? null,
        updated_at: token?.updated_at ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Created service token identifier' },
    name: { type: 'string', description: 'Service token name', optional: true },
    client_id: {
      type: 'string',
      description: 'Client ID sent in the CF-Access-Client-Id header',
      optional: true,
    },
    client_secret: {
      type: 'string',
      description:
        'Client secret sent in the CF-Access-Client-Secret header. Returned only once, at creation',
      optional: true,
    },
    duration: {
      type: 'string',
      description: 'How long the token stays valid before it expires',
      optional: true,
    },
    enabled: { type: 'boolean', description: 'Whether the token is active', optional: true },
    expires_at: { type: 'string', description: 'Expiry timestamp', optional: true },
    last_seen_at: { type: 'string', description: 'When the token was last used', optional: true },
    created_at: { type: 'string', description: 'Creation timestamp', optional: true },
    updated_at: { type: 'string', description: 'Last update timestamp', optional: true },
  },
}
