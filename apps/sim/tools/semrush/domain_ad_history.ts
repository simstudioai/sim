import type {
  SemrushDomainAdHistoryParams,
  SemrushDomainAdHistoryResponse,
  SemrushDomainAdHistoryRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_ANALYTICS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['Ph', 'Dt', 'Po', 'Cp', 'Nq', 'Tr', 'Ur', 'Tt', 'Ds', 'Vu'] as const

export const semrushDomainAdHistoryTool: ToolConfig<
  SemrushDomainAdHistoryParams,
  SemrushDomainAdHistoryResponse
> = {
  id: 'semrush_domain_ad_history',
  name: 'Semrush Domain Ad History',
  description:
    'List a domain past Google Ads placements month by month, with the copy used each time.',
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
    displaySort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order, for example dt_desc',
    },
    displayFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semrush display_filter expression, for example +|Ph|Co|shoes',
    },
  },

  request: {
    url: (params) =>
      buildSemrushUrl(SEMRUSH_ANALYTICS_URL, {
        apiKey: params.apiKey,
        type: 'domain_adwords_historical',
        columnCodes: COLUMNS,
        extra: {
          domain: params.domain,
          database: params.database,
          display_limit: normalizeLimit(params.limit, 50),
          display_offset: params.offset,
          display_sort: params.displaySort,
          display_filter: params.displayFilter,
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushDomainAdHistoryRow>(response, COLUMNS)

    return {
      success: true,
      output: { ads: rows },
    }
  },

  outputs: {
    ads: {
      type: 'array',
      description: 'Historical ad placements, one row per keyword and month',
      items: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: 'Keyword phrase',
            optional: true,
            nullable: true,
          },
          date: {
            type: 'string',
            description: 'Data collection date in YYYYMMDD or YYYYMM format',
            optional: true,
            nullable: true,
          },
          position: {
            type: 'number',
            description: 'Position in the Google top 100 results, where 0 means not ranked',
            optional: true,
            nullable: true,
          },
          cpc: {
            type: 'number',
            description: 'Average cost per click in USD (Google Ads)',
            optional: true,
            nullable: true,
          },
          searchVolume: {
            type: 'number',
            description: 'Average monthly searches for the keyword',
            optional: true,
            nullable: true,
          },
          trafficPercent: {
            type: 'number',
            description: 'Share of the traffic to the target driven by this keyword',
            optional: true,
            nullable: true,
          },
          url: {
            type: 'string',
            description: 'URL of the ranking or advertised page',
            optional: true,
            nullable: true,
          },
          title: {
            type: 'string',
            description: 'Ad or product title',
            optional: true,
            nullable: true,
          },
          description: {
            type: 'string',
            description: 'Ad text',
            optional: true,
            nullable: true,
          },
          visibleUrl: {
            type: 'string',
            description: 'Display URL shown in the ad',
            optional: true,
            nullable: true,
          },
        },
      },
    },
  },
}
