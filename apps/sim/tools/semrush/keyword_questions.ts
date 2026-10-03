import type {
  SemrushKeywordQuestionsParams,
  SemrushKeywordQuestionsResponse,
  SemrushKeywordQuestionsRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_ANALYTICS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['Ph', 'Nq', 'Cp', 'Co', 'Nr', 'Kd', 'In', 'Td'] as const

export const semrushKeywordQuestionsTool: ToolConfig<
  SemrushKeywordQuestionsParams,
  SemrushKeywordQuestionsResponse
> = {
  id: 'semrush_keyword_questions',
  name: 'Semrush Keyword Questions',
  description: 'Find question-form keywords containing a seed keyword, with volume and difficulty.',
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
    displaySort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order, for example nq_desc or kd_asc',
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
        type: 'phrase_questions',
        columnCodes: COLUMNS,
        extra: {
          phrase: params.phrase,
          database: params.database,
          display_limit: normalizeLimit(params.limit, 100),
          display_offset: params.offset,
          display_sort: params.displaySort,
          display_filter: params.displayFilter,
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushKeywordQuestionsRow>(response, COLUMNS)

    return {
      success: true,
      output: { keywords: rows },
    }
  },

  outputs: {
    keywords: {
      type: 'array',
      description: 'Question keywords containing the seed keyword',
      items: {
        type: 'object',
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
  },
}
