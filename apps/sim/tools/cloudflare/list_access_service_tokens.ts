import { RESULT_INFO_OUTPUTS, SERVICE_TOKEN_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareListAccessServiceTokensParams,
  CloudflareListAccessServiceTokensResponse,
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

export const listAccessServiceTokensTool: ToolConfig<
  CloudflareListAccessServiceTokensParams,
  CloudflareListAccessServiceTokensResponse
> = {
  id: 'cloudflare_list_access_service_tokens',
  name: 'Cloudflare List Access Service Tokens',
  description:
    'Lists the Cloudflare Access (Zero Trust) service tokens in an account, which let machines authenticate to Access-protected applications. Client secrets are never returned by this endpoint — only on creation. Requires an API token with Account Access: Service Tokens Read.',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by service token name',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text search across service tokens',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of service tokens per page',
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
        `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/access/service_tokens`
      )
      appendParam(url, 'name', params.name)
      appendParam(url, 'search', params.search)
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
        service_tokens: rows.map((row) => mapCloudflareFields(row, SERVICE_TOKEN_OUTPUTS)),
        total_count: data.result_info?.total_count ?? rows.length,
        result_info: data.result_info ?? null,
      },
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to list access service tokens') }
        : {}),
    }
  },
  outputs: {
    service_tokens: {
      type: 'array',
      description: 'Service tokens',
      items: { type: 'object', properties: SERVICE_TOKEN_OUTPUTS },
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
