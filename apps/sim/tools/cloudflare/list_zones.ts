import { RESULT_INFO_OUTPUTS, ZONE_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareListZonesParams,
  CloudflareListZonesResponse,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  mapCloudflareFields,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const listZonesTool: ToolConfig<CloudflareListZonesParams, CloudflareListZonesResponse> = {
  id: 'cloudflare_list_zones',
  name: 'Cloudflare List Zones',
  description: 'Lists one page of zones (domains) in the Cloudflare account.',
  version: '1.0.0',

  params: {
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated zone types: full, partial, secondary, internal',
    },
    account_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Account name; prefix the value with an operator, e.g. contains:Test. Supported operators: * `equal` (default) * `not_equal` * `starts_with` * `ends_with` * `contains` * `starts_with_case_sensitive` * `ends_with_case_sensitive` * `contains_case_sensitive`',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter zones by domain name (e.g., "example.com")',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by zone status: "initializing", "pending", "active", or "moved"',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for pagination (default: 1)',
    },
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of zones per page (default: 20, max: 50)',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter zones by account ID',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field (name, status, account.id, account.name, plan.id)',
    },
    direction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction (asc, desc)',
    },
    match: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Match logic for filters (any, all). Default: all',
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
      const url = new URL('https://api.cloudflare.com/client/v4/zones')
      if (params.name) url.searchParams.append('name', params.name)
      if (params.status) url.searchParams.append('status', params.status)
      if (params.page) url.searchParams.append('page', String(params.page))
      if (params.per_page) url.searchParams.append('per_page', String(params.per_page))
      if (params.accountId) url.searchParams.append('account.id', params.accountId.trim())
      if (params.order) url.searchParams.append('order', params.order)
      if (params.direction) url.searchParams.append('direction', params.direction)
      if (params.match) url.searchParams.append('match', params.match)
      appendParam(url, 'type', params.type)
      appendParam(url, 'account.name', params.account_name)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const raw = data.result
    const rows = Array.isArray(raw) ? raw : []
    const success = response.ok && data.success === true && Array.isArray(raw)
    return {
      success,
      output: {
        zones: rows.map((row) => mapCloudflareFields(row, ZONE_OUTPUTS)),
        total_count: data.result_info?.total_count ?? rows.length,
        result_info: data.result_info ?? null,
      },
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to list zones') } : {}),
    }
  },
  outputs: {
    zones: {
      type: 'array',
      description: 'Zones',
      items: { type: 'object', properties: ZONE_OUTPUTS },
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
