import type {
  SemrushSubdomainPaidKeywordsParams,
  SemrushSubdomainPaidKeywordsResponse,
  SemrushSubdomainPaidKeywordsRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_ANALYTICS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = [
  'Ph',
  'Po',
  'Pp',
  'Pd',
  'Nq',
  'Cp',
  'Ur',
  'Vu',
  'Tt',
  'Ds',
  'Tg',
  'Tr',
  'Tc',
  'Co',
  'Nr',
] as const

export const semrushSubdomainPaidKeywordsTool: ToolConfig<
  SemrushSubdomainPaidKeywordsParams,
  SemrushSubdomainPaidKeywordsResponse
> = {
  id: 'semrush_subdomain_paid_keywords',
  name: 'Semrush Subdomain Paid Keywords',
  description: 'List the keywords a subdomain buys in Google Ads.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Semrush API key',
    },
    subdomain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Subdomain to analyze, for example blog.example.com',
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
    displaySort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order, for example po_asc, tr_desc, or nq_desc',
    },
    displayFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semrush display_filter expression, for example +|Nq|Gt|1000',
    },
  },

  request: {
    url: (params) =>
      buildSemrushUrl(SEMRUSH_ANALYTICS_URL, {
        apiKey: params.apiKey,
        type: 'subdomain_adwords',
        columnCodes: COLUMNS,
        extra: {
          subdomain: params.subdomain,
          database: params.database,
          display_limit: normalizeLimit(params.limit, 100),
          display_offset: params.offset,
          display_date: params.displayDate,
          display_sort: params.displaySort,
          display_filter: params.displayFilter,
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushSubdomainPaidKeywordsRow>(response, COLUMNS)

    return {
      success: true,
      output: { keywords: rows },
    }
  },

  outputs: {
    keywords: {
      type: 'array',
      description: 'Paid keywords the subdomain bids on',
      items: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: 'Keyword phrase',
            optional: true,
            nullable: true,
          },
          position: {
            type: 'number',
            description: 'Position in the Google top 100 results, where 0 means not ranked',
            optional: true,
            nullable: true,
          },
          previousPosition: {
            type: 'number',
            description: 'Position held at the previous data collection',
            optional: true,
            nullable: true,
          },
          positionDifference: {
            type: 'number',
            description: 'Change between the previous and the current position',
            optional: true,
            nullable: true,
          },
          searchVolume: {
            type: 'number',
            description: 'Average monthly searches for the keyword',
            optional: true,
            nullable: true,
          },
          cpc: {
            type: 'number',
            description: 'Average cost per click in USD (Google Ads)',
            optional: true,
            nullable: true,
          },
          url: {
            type: 'string',
            description: 'URL of the ranking or advertised page',
            optional: true,
            nullable: true,
          },
          visibleUrl: {
            type: 'string',
            description: 'Display URL shown in the ad',
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
          traffic: {
            type: 'number',
            description: 'Estimated traffic driven by this keyword',
            optional: true,
            nullable: true,
          },
          trafficPercent: {
            type: 'number',
            description: 'Share of the traffic to the target driven by this keyword',
            optional: true,
            nullable: true,
          },
          trafficCost: {
            type: 'number',
            description: 'Estimated traffic cost attributed to this keyword',
            optional: true,
            nullable: true,
          },
          competition: {
            type: 'number',
            description: 'Competitive density of advertisers bidding on the keyword (0-1)',
            optional: true,
            nullable: true,
          },
          numberOfResults: {
            type: 'number',
            description: 'Total organic results returned for the keyword',
            optional: true,
            nullable: true,
          },
        },
      },
    },
  },
}
