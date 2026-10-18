import { ACCESS_GROUP_OUTPUTS, RESULT_INFO_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareListAccessGroupsParams,
  CloudflareListAccessGroupsResponse,
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

export const listAccessGroupsTool: ToolConfig<
  CloudflareListAccessGroupsParams,
  CloudflareListAccessGroupsResponse
> = {
  id: 'cloudflare_list_access_groups',
  name: 'Cloudflare List Access Groups',
  description:
    'Lists the reusable Cloudflare Access (Zero Trust) groups in an account. Groups bundle identity rules that policies can reference by ID. Requires an API token with Account Access: Organizations, Identity Providers, and Groups Read.',
  version: '1.0.0',

  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. Access groups are account-scoped',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by group name',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text search across groups',
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
      description: 'Number of groups per page',
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
        `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/access/groups`
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
        groups: rows.map((row) => mapCloudflareFields(row, ACCESS_GROUP_OUTPUTS)),
        total_count: data.result_info?.total_count ?? rows.length,
        result_info: data.result_info ?? null,
      },
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to list access groups') } : {}),
    }
  },
  outputs: {
    groups: {
      type: 'array',
      description: 'Groups',
      items: { type: 'object', properties: ACCESS_GROUP_OUTPUTS },
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
