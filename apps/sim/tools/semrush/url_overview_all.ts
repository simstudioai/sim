import type {
  SemrushUrlOverviewAllParams,
  SemrushUrlOverviewAllResponse,
  SemrushUrlOverviewAllRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_ANALYTICS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['Db', 'Dn', 'Rk', 'Or', 'Ot', 'Oc', 'Ad', 'At', 'Ac', 'Sh', 'Sv'] as const

export const semrushUrlOverviewAllTool: ToolConfig<
  SemrushUrlOverviewAllParams,
  SemrushUrlOverviewAllResponse
> = {
  id: 'semrush_url_overview_all',
  name: 'Semrush URL Overview (All Databases)',
  description:
    'Get organic and paid search totals for a single URL across every regional Semrush database.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Semrush API key',
    },
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Full URL to analyze, for example https://example.com/pricing',
    },
    database: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Regional database code to restrict the report to, for example us',
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
    displayDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Historical month in YYYYMM15 format',
    },
    displaySort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order, for example rk_asc or ot_desc',
    },
  },

  request: {
    url: (params) =>
      buildSemrushUrl(SEMRUSH_ANALYTICS_URL, {
        apiKey: params.apiKey,
        type: 'url_ranks',
        columnCodes: COLUMNS,
        extra: {
          url: params.url,
          database: params.database,
          display_limit: normalizeLimit(params.limit, 100),
          display_offset: params.offset,
          display_date: params.displayDate,
          display_sort: params.displaySort,
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushUrlOverviewAllRow>(response, COLUMNS)

    return {
      success: true,
      output: { databases: rows },
    }
  },

  outputs: {
    databases: {
      type: 'array',
      description: 'One row of URL totals per regional database',
      items: {
        type: 'object',
        properties: {
          database: {
            type: 'string',
            description: 'Regional database the row belongs to',
            optional: true,
            nullable: true,
          },
          domain: {
            type: 'string',
            description: 'Domain name',
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
          plaKeywords: {
            type: 'number',
            description: 'Keywords used for product listing ads',
            optional: true,
            nullable: true,
          },
          plaUniques: {
            type: 'number',
            description: 'Number of unique product listing ads',
            optional: true,
            nullable: true,
          },
        },
      },
    },
  },
}
