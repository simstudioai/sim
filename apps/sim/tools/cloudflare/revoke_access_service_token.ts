import { SERVICE_TOKEN_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareAccessServiceTokenResponse,
  CloudflareRevokeAccessServiceTokenParams,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
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
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true
    return {
      success,
      output: mapCloudflareFields(data.result, SERVICE_TOKEN_OUTPUTS),
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to revoke access service token') }
        : {}),
    }
  },
  outputs: SERVICE_TOKEN_OUTPUTS,
}
