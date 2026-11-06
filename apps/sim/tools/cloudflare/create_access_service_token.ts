import { isRecordLike } from '@sim/utils/object'
import { SERVICE_TOKEN_SECRET_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareCreateAccessServiceTokenParams,
  CloudflareCreateAccessServiceTokenResponse,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
    client_secret_version: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'A version number identifying the current `client_secret` associated with the service token. Incrementing it triggers a rotation; the previous secret will still be accepted until the time indicated by `previous_client_secret_expires_at`. If the service token was reported as leaked, `previous_client_secret_expires_at` is not required, may not be in the future, and the previous secret is discarded immediately.',
    },
    enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the service token is enabled. A disabled service token cannot be used to authenticate; both its current and previous `client_secret` stop being accepted, but the token itself is preserved and can be re-enabled. A service token reported as leaked is disabled automatically and cannot be re-enabled until its secret is rotated; attempting to do so returns a 409. Defaults to enabled when omitted on create.',
    },
    previous_client_secret_expires_at: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The expiration of the previous `client_secret`. This can be modified at any point after a rotation. For example, you may extend it further into the future if you need more time to update services with the new secret; or move it into the past to immediately invalidate the previous token in case of compromise. Rotating a service token that was reported as leaked discards the previous secret entirely, so no grace period can be set.',
    },
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
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/access/service_tokens`,
    method: 'POST',
    headers: (params) => cloudflareHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = { name: params.name }
      if (params.duration) body.duration = params.duration
      if (params.client_secret_version !== undefined)
        body.client_secret_version = params.client_secret_version
      if (params.enabled !== undefined) body.enabled = params.enabled
      if (
        params.previous_client_secret_expires_at !== undefined &&
        params.previous_client_secret_expires_at !== ''
      )
        body.previous_client_secret_expires_at = params.previous_client_secret_expires_at
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, SERVICE_TOKEN_SECRET_OUTPUTS),
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to create access service token') }
        : {}),
    }
  },
  outputs: SERVICE_TOKEN_SECRET_OUTPUTS,
}
