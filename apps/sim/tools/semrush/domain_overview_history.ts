import type {
  SemrushDomainOverviewHistoryParams,
  SemrushDomainOverviewHistoryResponse,
  SemrushDomainOverviewHistoryRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_ANALYTICS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['Dt', 'Rk', 'Or', 'Ot', 'Oc', 'Ad', 'At', 'Ac'] as const

export const semrushDomainOverviewHistoryTool: ToolConfig<
  SemrushDomainOverviewHistoryParams,
  SemrushDomainOverviewHistoryResponse
> = {
  id: 'semrush_domain_overview_history',
  name: 'Semrush Domain Overview History',
  description: 'Get the historical trend of a domain rank plus its organic and paid search totals.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Semrush API key',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Domain to analyze, for example example.com',
    },
    database: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Regional database code, for example us, uk, de, or fr',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of rows to return, capped at 100,000',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of rows to skip, for pagination',
    },
    displayDaily: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return daily data points for the last 31 days instead of monthly ones',
    },
    displaySort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order, for example dt_desc or dt_asc',
    },
  },

  request: {
    url: (params) =>
      buildSemrushUrl(SEMRUSH_ANALYTICS_URL, {
        apiKey: params.apiKey,
        type: 'domain_rank_history',
        columnCodes: COLUMNS,
        extra: {
          domain: params.domain,
          database: params.database,
          display_limit: normalizeLimit(params.limit, 50),
          display_offset: params.offset,
          display_daily: params.displayDaily ? 1 : undefined,
          display_sort: params.displaySort,
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushDomainOverviewHistoryRow>(response, COLUMNS)

    return {
      success: true,
      output: { history: rows },
    }
  },

  outputs: {
    history: {
      type: 'array',
      description: 'Historical data points, in the requested sort order',
      items: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Data collection date in YYYYMMDD or YYYYMM format',
            optional: true,
            nullable: true,
          },
          rank: {
            type: 'number',
            description: 'Semrush popularity rating of the target, based on organic traffic',
            optional: true,
            nullable: true,
          },
          organicKeywords: {
            type: 'number',
            description: 'Keywords bringing users via the Google top 100 organic results',
            optional: true,
            nullable: true,
          },
          organicTraffic: {
            type: 'number',
            description: 'Traffic brought via the Google top 100 organic results',
            optional: true,
            nullable: true,
          },
          organicCost: {
            type: 'number',
            description: 'Estimated Google Ads price of the organic keywords',
            optional: true,
            nullable: true,
          },
          paidKeywords: {
            type: 'number',
            description: 'Keywords the target is buying in Google Ads',
            optional: true,
            nullable: true,
          },
          paidTraffic: {
            type: 'number',
            description: 'Traffic brought via paid search results',
            optional: true,
            nullable: true,
          },
          paidCost: {
            type: 'number',
            description: 'Estimated monthly Google Ads budget',
            optional: true,
            nullable: true,
          },
        },
      },
    },
  },
}
