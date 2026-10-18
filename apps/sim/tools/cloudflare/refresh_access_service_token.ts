import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareRefreshAccessServiceTokenParams,
  CloudflareRefreshAccessServiceTokenResponse,
} from '@/tools/cloudflare/operation-types'
import { SERVICE_TOKEN_OUTPUTS } from '@/tools/cloudflare/outputs'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const refreshAccessServiceTokenTool: ToolConfig<
  CloudflareRefreshAccessServiceTokenParams,
  CloudflareRefreshAccessServiceTokenResponse
> = {
  id: 'cloudflare_refresh_access_service_token',
  name: 'Cloudflare Refresh Access Service Token',
  description: 'Refreshes the expiration of a service token.',
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
  },
  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/access/service_tokens/${safeUrlPathSegment(params.serviceTokenId, 'serviceTokenId')}/refresh`,
    method: 'POST',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, SERVICE_TOKEN_OUTPUTS),
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to refresh access service token') }
        : {}),
    }
  },
  outputs: SERVICE_TOKEN_OUTPUTS,
}
