import type {
  SemrushKeywordDifficultyParams,
  SemrushKeywordDifficultyResponse,
  SemrushKeywordDifficultyRow,
} from '@/tools/semrush/types'
import { buildSemrushUrl, readSemrushReport, SEMRUSH_ANALYTICS_URL } from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['Ph', 'Kd'] as const

export const semrushKeywordDifficultyTool: ToolConfig<
  SemrushKeywordDifficultyParams,
  SemrushKeywordDifficultyResponse
> = {
  id: 'semrush_keyword_difficulty',
  name: 'Semrush Keyword Difficulty',
  description: 'Get the Keyword Difficulty Index for up to 100 keywords at once.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Semrush API key',
    },
    phrases: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated list of keywords, for example ebay;seo',
    },
    database: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Regional database code, for example us, uk, de, or fr',
    },
  },

  request: {
    url: (params) =>
      buildSemrushUrl(SEMRUSH_ANALYTICS_URL, {
        apiKey: params.apiKey,
        type: 'phrase_kdi',
        columnCodes: COLUMNS,
        extra: {
          phrase: params.phrases,
          database: params.database,
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushKeywordDifficultyRow>(response, COLUMNS)

    return {
      success: true,
      output: { keywords: rows },
    }
  },

  outputs: {
    keywords: {
      type: 'array',
      description: 'Keyword difficulty scores, one row per submitted keyword',
      items: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: 'Keyword phrase',
            optional: true,
            nullable: true,
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
