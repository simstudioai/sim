import type { MintlifyGetVisitorsParams, MintlifyGetVisitorsResponse } from '@/tools/mintlify/types'
import {
  appendParam,
  MINTLIFY_API_BASE,
  mintlifyHeaders,
  pathSegment,
  readMintlifyJson,
  TRAFFIC_TOTALS_OUTPUT,
  toTrafficRows,
  toTrafficTotals,
} from '@/tools/mintlify/utils'
import type { ToolConfig } from '@/tools/types'

export const mintlifyGetVisitorsTool: ToolConfig<
  MintlifyGetVisitorsParams,
  MintlifyGetVisitorsResponse
> = {
  id: 'mintlify_get_visitors',
  name: 'Mintlify Get Unique Visitors',
  description:
    'Export Mintlify per-path and site-wide approximate distinct visitor counts for a date range, split by human and AI bot traffic.',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Mintlify project ID, copied from the API keys page in your dashboard',
    },
    dateFrom: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Inclusive start date in ISO 8601 or YYYY-MM-DD format',
    },
    dateTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclusive end date in ISO 8601 or YYYY-MM-DD format',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max results per page, between 1 and 250 (default 50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of rows to skip for offset-based pagination (default 0)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mintlify admin API key (starts with mint_)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${MINTLIFY_API_BASE}/v1/analytics/${pathSegment(params.projectId)}/visitors`
      )
      appendParam(url, 'dateFrom', params.dateFrom)
      appendParam(url, 'dateTo', params.dateTo)
      appendParam(url, 'limit', params.limit)
      appendParam(url, 'offset', params.offset)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => mintlifyHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readMintlifyJson(response, 'Failed to get Mintlify unique visitors')

    return {
      success: true,
      output: {
        totals: toTrafficTotals(data.totals),
        visitors: toTrafficRows(data.visitors),
        hasMore: data.hasMore === true,
      },
    }
  },

  outputs: {
    totals: {
      ...TRAFFIC_TOTALS_OUTPUT,
      description:
        'Site-wide unique visitor totals for the date range, deduplicated across human and AI',
    },
    visitors: {
      type: 'array',
      description: 'Per-page unique visitor counts',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The documentation page path', nullable: true },
          human: { type: 'number', description: 'Unique human visitors', nullable: true },
          ai: { type: 'number', description: 'Unique AI bot visitors', nullable: true },
          total: {
            type: 'number',
            description: 'Approximate distinct visitors, deduplicated across human and AI',
            nullable: true,
          },
        },
      },
    },
    hasMore: { type: 'boolean', description: 'Whether additional results are available' },
  },
}
