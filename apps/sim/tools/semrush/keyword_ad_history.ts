import type {
  SemrushKeywordAdHistoryParams,
  SemrushKeywordAdHistoryResponse,
  SemrushKeywordAdHistoryRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_ANALYTICS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['Dn', 'Dt', 'Po', 'Ur', 'Tt', 'Ds', 'Vu'] as const

export const semrushKeywordAdHistoryTool: ToolConfig<
  SemrushKeywordAdHistoryParams,
  SemrushKeywordAdHistoryResponse
> = {
  id: 'semrush_keyword_ad_history',
  name: 'Semrush Keyword Ad History',
  description:
    'List which domains advertised on a keyword month by month, with the copy each one used.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Semrush API key',
    },
    phrase: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Keyword to analyze',
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
  },

  request: {
    url: (params) =>
      buildSemrushUrl(SEMRUSH_ANALYTICS_URL, {
        apiKey: params.apiKey,
        type: 'phrase_adwords_historical',
        columnCodes: COLUMNS,
        extra: {
          phrase: params.phrase,
          database: params.database,
          display_limit: normalizeLimit(params.limit, 50),
          display_offset: params.offset,
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushKeywordAdHistoryRow>(response, COLUMNS)

    return {
      success: true,
      output: { ads: rows },
    }
  },

  outputs: {
    ads: {
      type: 'array',
      description: 'Historical advertisers for the keyword, one row per domain and month',
      items: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            description: 'Domain name',
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
