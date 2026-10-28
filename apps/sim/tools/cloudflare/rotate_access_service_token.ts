import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareRotateAccessServiceTokenParams,
  CloudflareRotateAccessServiceTokenResponse,
} from '@/tools/cloudflare/operation-types'
import { SERVICE_TOKEN_SECRET_OUTPUTS } from '@/tools/cloudflare/outputs'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const rotateAccessServiceTokenTool: ToolConfig<
  CloudflareRotateAccessServiceTokenParams,
  CloudflareRotateAccessServiceTokenResponse
> = {
  id: 'cloudflare_rotate_access_service_token',
  name: 'Cloudflare Rotate Access Service Token',
  description:
    'Generates a new Client Secret. The previous secret expires immediately unless previous_client_secret_expires_at schedules a later expiration.',
  version: '1.0.0',
  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Account id',
    },
    serviceTokenId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Service token id',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API token',
    },
    previous_client_secret_expires_at: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The expiration of the previous `client_secret`. If not provided, it defaults to the current timestamp in order to immediately expire the previous secret. If the service token was reported as leaked, this must not be in the future; the leaked secret is discarded immediately.',
    },
  },
  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/access/service_tokens/${safeUrlPathSegment(params.serviceTokenId, 'serviceTokenId')}/rotate`,
    method: 'POST',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
    body: (params) => ({
      previous_client_secret_expires_at:
        params.previous_client_secret_expires_at === ''
          ? undefined
          : params.previous_client_secret_expires_at,
    }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, SERVICE_TOKEN_SECRET_OUTPUTS),
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to rotate access service token') }
        : {}),
    }
  },
  outputs: SERVICE_TOKEN_SECRET_OUTPUTS,
}
