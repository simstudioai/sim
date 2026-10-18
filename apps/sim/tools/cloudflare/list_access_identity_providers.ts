import { IDENTITY_PROVIDER_OUTPUTS, RESULT_INFO_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareListAccessIdentityProvidersParams,
  CloudflareListAccessIdentityProvidersResponse,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const listAccessIdentityProvidersTool: ToolConfig<
  CloudflareListAccessIdentityProvidersParams,
  CloudflareListAccessIdentityProvidersResponse
> = {
  id: 'cloudflare_list_access_identity_providers',
  name: 'Cloudflare List Access Identity Providers',
  description:
    'Lists the identity providers configured for Cloudflare Access (Zero Trust) in an account, such as Okta, Entra ID, Google Workspace, or a one-time PIN. Use the returned IDs to restrict an application with allowed_idps. Requires an API token with Account Access: Organizations, Identity Providers, and Groups Read.',
  version: '1.0.0',

  params: {
    scim_enabled: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Indicates to Access to only retrieve identity providers that have the System for Cross-Domain Identity Management (SCIM) enabled.',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number of results.',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page.',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. Identity providers are account-scoped',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/access/identity_providers`
      )
      appendParam(url, 'scim_enabled', params.scim_enabled)
      appendParam(url, 'page', params.page)
      appendParam(url, 'per_page', params.per_page)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const raw = data.result
    const rows = Array.isArray(raw) ? raw : []
    const success = response.ok && data.success === true && Array.isArray(raw)
    return {
      success,
      output: {
        identity_providers: rows.map((row) => mapCloudflareFields(row, IDENTITY_PROVIDER_OUTPUTS)),
        total_count: data.result_info?.total_count ?? rows.length,
        result_info: data.result_info ?? null,
      },
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to list access identity providers') }
        : {}),
    }
  },
  outputs: {
    identity_providers: {
      type: 'array',
      description: 'Identity providers',
      items: { type: 'object', properties: IDENTITY_PROVIDER_OUTPUTS },
    },
    total_count: {
      type: 'number',
      description:
        'Total matching resources, or the number of resources returned on this page when the API omits a total',
    },
    result_info: {
      type: 'json',
      description: 'Pagination metadata returned by Cloudflare',
      nullable: true,
      properties: RESULT_INFO_OUTPUTS,
    },
  },
}
