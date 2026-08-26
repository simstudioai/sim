import type {
  SemrushUrlOrganicKeywordsParams,
  SemrushUrlOrganicKeywordsResponse,
  SemrushUrlOrganicKeywordsRow,
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
  'Nq',
  'Cp',
  'Co',
  'Kd',
  'Tr',
  'Tg',
  'Tc',
  'Nr',
  'In',
  'Td',
] as const

export const semrushUrlOrganicKeywordsTool: ToolConfig<
  SemrushUrlOrganicKeywordsParams,
  SemrushUrlOrganicKeywordsResponse
> = {
  id: 'semrush_url_organic_keywords',
  name: 'Semrush URL Organic Keywords',
  description: 'List the keywords a single URL ranks for in Google organic search.',
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
      description: 'Sort order, for example tr_desc, po_asc, or nq_desc',
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
        type: 'url_organic',
        columnCodes: COLUMNS,
        extra: {
          url: params.url,
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
    const rows = await readSemrushReport<SemrushUrlOrganicKeywordsRow>(response, COLUMNS)

    return {
      success: true,
      output: { keywords: rows },
    }
  },

  outputs: {
    keywords: {
      type: 'array',
      description: 'Organic keywords the URL ranks for',
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
          competition: {
            type: 'number',
            description: 'Competitive density of advertisers bidding on the keyword (0-1)',
            optional: true,
            nullable: true,
          },
          keywordDifficulty: {
            type: 'number',
            description: 'Estimated difficulty of ranking for the keyword (0-100)',
            optional: true,
            nullable: true,
          },
          trafficPercent: {
            type: 'number',
            description: 'Share of the traffic to the target driven by this keyword',
            optional: true,
            nullable: true,
          },
          traffic: {
            type: 'number',
            description: 'Estimated traffic driven by this keyword',
            optional: true,
            nullable: true,
          },
          trafficCost: {
            type: 'number',
            description: 'Estimated traffic cost attributed to this keyword',
            optional: true,
            nullable: true,
          },
          numberOfResults: {
            type: 'number',
            description: 'Total organic results returned for the keyword',
            optional: true,
            nullable: true,
          },
          intents: {
            type: 'array',
            description:
              'Keyword intents: 0 commercial, 1 informational, 2 navigational, 3 transactional',
            optional: true,
            items: { type: 'number' },
          },
          trends: {
            type: 'array',
            description: 'Relative search interest over the last 12 months',
            optional: true,
            items: { type: 'number' },
          },
        },
      },
    },
  },
}
