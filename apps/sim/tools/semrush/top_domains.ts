import type {
  SemrushTopDomainsParams,
  SemrushTopDomainsResponse,
  SemrushTopDomainsRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_ANALYTICS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['Dn', 'Rk', 'Or', 'Ot', 'Oc', 'Ad', 'At', 'Ac'] as const

export const semrushTopDomainsTool: ToolConfig<SemrushTopDomainsParams, SemrushTopDomainsResponse> =
  {
    id: 'semrush_top_domains',
    name: 'Semrush Top Domains',
    description: 'List the highest-ranked domains in a regional database by Semrush rank.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Semrush API key',
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
      displayDate: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Historical month in YYYYMM15 format',
      },
      displayFilter: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Semrush display_filter expression, for example +|Or|Gt|100000',
      },
    },

    request: {
      url: (params) =>
        buildSemrushUrl(SEMRUSH_ANALYTICS_URL, {
          apiKey: params.apiKey,
          type: 'rank',
          columnCodes: COLUMNS,
          extra: {
            database: params.database,
            display_limit: normalizeLimit(params.limit, 50),
            display_offset: params.offset,
            display_date: params.displayDate,
            display_filter: params.displayFilter,
          },
        }),
      method: 'GET',
      headers: () => ({ Accept: 'text/csv' }),
    },

    transformResponse: async (response: Response) => {
      const rows = await readSemrushReport<SemrushTopDomainsRow>(response, COLUMNS)

      return {
        success: true,
        output: { domains: rows },
      }
    },

    outputs: {
      domains: {
        type: 'array',
        description: 'Top-ranked domains in the database',
        items: {
          type: 'object',
          properties: {
            domain: {
              type: 'string',
              description: 'Domain name',
              optional: true,
              nullable: true,
            },
            rank: {
              type: 'number',
              description: 'Semrush popularity rating of this domain, based on organic traffic',
              optional: true,
              nullable: true,
            },
            organicKeywords: {
              type: 'number',
              description: 'Keywords this domain ranks for in the Google top 100 organic results',
              optional: true,
              nullable: true,
            },
            organicTraffic: {
              type: 'number',
              description: 'Traffic this domain gets from the Google top 100 organic results',
              optional: true,
              nullable: true,
            },
            organicCost: {
              type: 'number',
              description: 'Estimated Google Ads price of this domain organic keywords',
              optional: true,
              nullable: true,
            },
            paidKeywords: {
              type: 'number',
              description: 'Keywords this domain is buying in Google Ads',
              optional: true,
              nullable: true,
            },
            paidTraffic: {
              type: 'number',
              description: 'Traffic this domain gets from paid search results',
              optional: true,
              nullable: true,
            },
            paidCost: {
              type: 'number',
              description: 'Estimated monthly Google Ads budget of this domain',
              optional: true,
              nullable: true,
            },
          },
        },
      },
    },
  }
