import type {
  SemrushKeywordOverviewAllParams,
  SemrushKeywordOverviewAllResponse,
  SemrushKeywordOverviewAllRow,
} from '@/tools/semrush/types'
import { buildSemrushUrl, readSemrushReport, SEMRUSH_ANALYTICS_URL } from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['Dt', 'Db', 'Ph', 'Nq', 'Cp', 'Co', 'Nr', 'In', 'Kd'] as const

export const semrushKeywordOverviewAllTool: ToolConfig<
  SemrushKeywordOverviewAllParams,
  SemrushKeywordOverviewAllResponse
> = {
  id: 'semrush_keyword_overview_all',
  name: 'Semrush Keyword Overview (All Databases)',
  description:
    'Get search volume, CPC, and competition for a keyword across every regional Semrush database.',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Regional database code to restrict the report to, for example us',
    },
  },

  request: {
    url: (params) =>
      buildSemrushUrl(SEMRUSH_ANALYTICS_URL, {
        apiKey: params.apiKey,
        type: 'phrase_all',
        columnCodes: COLUMNS,
        extra: {
          phrase: params.phrase,
          database: params.database,
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushKeywordOverviewAllRow>(response, COLUMNS)

    return {
      success: true,
      output: { databases: rows },
    }
  },

  outputs: {
    databases: {
      type: 'array',
      description: 'One row of keyword metrics per regional database',
      items: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Data collection date in YYYYMMDD or YYYYMM format',
            optional: true,
            nullable: true,
          },
          database: {
            type: 'string',
            description: 'Regional database the row belongs to',
            optional: true,
            nullable: true,
          },
          keyword: {
            type: 'string',
            description: 'Keyword phrase',
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
          keywordDifficulty: {
            type: 'number',
            description: 'Estimated difficulty of ranking for the keyword (0-100)',
            optional: true,
            nullable: true,
          },
        },
      },
    },
  },
}
