import type {
  SemrushKeywordOverviewParams,
  SemrushKeywordOverviewResponse,
  SemrushKeywordOverviewRow,
} from '@/tools/semrush/types'
import { buildSemrushUrl, readSemrushReport, SEMRUSH_ANALYTICS_URL } from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['Ph', 'Nq', 'Cp', 'Co', 'Nr', 'Kd', 'In', 'Td'] as const

export const semrushKeywordOverviewTool: ToolConfig<
  SemrushKeywordOverviewParams,
  SemrushKeywordOverviewResponse
> = {
  id: 'semrush_keyword_overview',
  name: 'Semrush Keyword Overview',
  description: 'Get search volume, CPC, competition, difficulty, and intent for a single keyword.',
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
    displayDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Historical month in YYYYMM15 format',
    },
  },

  request: {
    url: (params) =>
      buildSemrushUrl(SEMRUSH_ANALYTICS_URL, {
        apiKey: params.apiKey,
        type: 'phrase_this',
        columnCodes: COLUMNS,
        extra: {
          phrase: params.phrase,
          database: params.database,
          display_date: params.displayDate,
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushKeywordOverviewRow>(response, COLUMNS)

    return {
      success: true,
      output: { overview: rows[0] ?? null },
    }
  },

  outputs: {
    overview: {
      type: 'json',
      description: 'Keyword metrics in the selected database',
      nullable: true,
      properties: {
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
        keywordDifficulty: {
          type: 'number',
          description: 'Estimated difficulty of ranking for the keyword (0-100)',
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
}
