import type {
  CloudflareAccessServiceTokenResponse,
  CloudflareRevokeAccessServiceTokenParams,
} from '@/tools/cloudflare/types'
import { cloudflareErrorMessage, cloudflareHeaders } from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const revokeAccessServiceTokenTool: ToolConfig<
  CloudflareRevokeAccessServiceTokenParams,
  CloudflareAccessServiceTokenResponse
> = {
  id: 'cloudflare_revoke_access_service_token',
  name: 'Cloudflare Revoke Access Service Token',
  description:
    'Permanently deletes a Cloudflare Access (Zero Trust) service token, revoking it. Every machine or integration still presenting that client ID and secret is locked out of the Access-protected applications immediately, and the secret cannot be recovered. This cannot be undone. Requires an API token with Account Access: Service Tokens Edit.',
  version: '1.0.0',

  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. Service tokens are account-scoped',
    },
    serviceTokenId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The service token ID to revoke permanently',
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
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/access/service_tokens/${safeUrlPathSegment(params.serviceTokenId, 'serviceTokenId')}`,
    method: 'DELETE',
    headers: (params) => cloudflareHeaders(params.apiKey),
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
          duration: null,
          enabled: null,
          expires_at: null,
          last_seen_at: null,
          created_at: null,
          updated_at: null,
        },
        error: cloudflareErrorMessage(data, 'Failed to revoke Access service token'),
      }
    }

    const token = data.result
    return {
      success: true,
      output: {
        id: token?.id ?? '',
        name: token?.name ?? null,
        client_id: token?.client_id ?? null,
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
    id: { type: 'string', description: 'Identifier of the revoked service token' },
    name: { type: 'string', description: 'Service token name', optional: true },
    client_id: {
      type: 'string',
      description: 'Client ID that is no longer accepted',
      optional: true,
    },
    duration: { type: 'string', description: 'Configured token lifetime', optional: true },
    enabled: { type: 'boolean', description: 'Whether the token was active', optional: true },
    expires_at: { type: 'string', description: 'Expiry timestamp', optional: true },
    last_seen_at: { type: 'string', description: 'When the token was last used', optional: true },
    created_at: { type: 'string', description: 'Creation timestamp', optional: true },
    updated_at: { type: 'string', description: 'Last update timestamp', optional: true },
  },
}
