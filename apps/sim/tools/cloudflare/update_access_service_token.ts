import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareUpdateAccessServiceTokenParams,
  CloudflareUpdateAccessServiceTokenResponse,
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

export const updateAccessServiceTokenTool: ToolConfig<
  CloudflareUpdateAccessServiceTokenParams,
  CloudflareUpdateAccessServiceTokenResponse
> = {
  id: 'cloudflare_update_access_service_token',
  name: 'Cloudflare Update Access Service Token',
  description:
    'Updates a configured service token. Replaces the configuration; resend all values to retain.',
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
    client_secret_version: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'A version number identifying the current `client_secret` associated with the service token. Incrementing it triggers a rotation; the previous secret will still be accepted until the time indicated by `previous_client_secret_expires_at`. If the service token was reported as leaked, `previous_client_secret_expires_at` is not required, may not be in the future, and the previous secret is discarded immediately.',
    },
    duration: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The duration for how long the service token will be valid. Must be in the format `300ms` or `2h45m`, or the special value `forever` for non-expiring tokens. Valid time units are: ns, us (or \u00b5s), ms, s, m, h. The default is 1 year in hours (8760h).',
    },
    enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the service token is enabled. A disabled service token cannot be used to authenticate; both its current and previous `client_secret` stop being accepted, but the token itself is preserved and can be re-enabled. A service token reported as leaked is disabled automatically and cannot be re-enabled until its secret is rotated; attempting to do so returns a 409. Defaults to enabled when omitted on create.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The name of the service token.',
    },
    previous_client_secret_expires_at: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The expiration of the previous `client_secret`. This can be modified at any point after a rotation. For example, you may extend it further into the future if you need more time to update services with the new secret; or move it into the past to immediately invalidate the previous token in case of compromise. Rotating a service token that was reported as leaked discards the previous secret entirely, so no grace period can be set.',
    },
  },
  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/access/service_tokens/${safeUrlPathSegment(params.serviceTokenId, 'serviceTokenId')}`,
    method: 'PUT',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
    body: (params) => ({
      client_secret_version: params.client_secret_version,
      duration: params.duration,
      enabled: params.enabled,
      name: params.name,
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
      output: mapCloudflareFields(data.result, SERVICE_TOKEN_OUTPUTS),
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to update access service token') }
        : {}),
    }
  },
  outputs: SERVICE_TOKEN_OUTPUTS,
}
