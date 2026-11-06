import { ACCESS_APPLICATION_OUTPUTS, RESULT_INFO_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareListAccessApplicationsParams,
  CloudflareListAccessApplicationsResponse,
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

export const listAccessApplicationsTool: ToolConfig<
  CloudflareListAccessApplicationsParams,
  CloudflareListAccessApplicationsResponse
> = {
  id: 'cloudflare_list_access_applications',
  name: 'Cloudflare List Access Applications',
  description:
    'Lists the Cloudflare Access (Zero Trust) applications protecting an account. Requires an API token with Account Access: Apps and Policies Read.',
  version: '1.0.0',

  params: {
    target_attributes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Target Criteria attributes in key=value format.',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. Access applications are account-scoped',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by application name',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by the primary hostname the application secures',
    },
    aud: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by application audience (AUD) tag',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text search across applications',
    },
    exact: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the name and domain filters must match exactly',
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
      description: 'Number of applications per page',
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
        `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/access/apps`
      )
      appendParam(url, 'name', params.name)
      appendParam(url, 'domain', params.domain)
      appendParam(url, 'aud', params.aud)
      appendParam(url, 'search', params.search)
      if (params.exact !== undefined) url.searchParams.append('exact', String(params.exact))
      appendParam(url, 'page', params.page)
      appendParam(url, 'per_page', params.per_page)
      appendParam(url, 'target_attributes', params.target_attributes)
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
        applications: rows.map((row) => mapCloudflareFields(row, ACCESS_APPLICATION_OUTPUTS)),
        total_count: data.result_info?.total_count ?? rows.length,
        result_info: data.result_info ?? null,
      },
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to list access applications') }
        : {}),
    }
  },
  outputs: {
    applications: {
      type: 'array',
      description: 'Applications',
      items: { type: 'object', properties: ACCESS_APPLICATION_OUTPUTS },
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
