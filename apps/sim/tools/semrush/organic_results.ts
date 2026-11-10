import type {
  SemrushOrganicResultsParams,
  SemrushOrganicResultsResponse,
  SemrushOrganicResultsRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_ANALYTICS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['Po', 'Pt', 'Dn', 'Ur', 'Fk', 'Fp'] as const

export const semrushOrganicResultsTool: ToolConfig<
  SemrushOrganicResultsParams,
  SemrushOrganicResultsResponse
> = {
  id: 'semrush_organic_results',
  name: 'Semrush Organic Results',
  description: 'List the domains and URLs ranking in Google organic search results for a keyword.',
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
        type: 'phrase_organic',
        columnCodes: COLUMNS,
        extra: {
          phrase: params.phrase,
          database: params.database,
          display_limit: normalizeLimit(params.limit, 20),
          display_offset: params.offset,
          display_date: params.displayDate,
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushOrganicResultsRow>(response, COLUMNS)

    return {
      success: true,
      output: { results: rows },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Ranking pages for the keyword, in SERP order',
      items: {
        type: 'object',
        properties: {
          position: {
            type: 'number',
            description: 'Position in the Google top 100 results, where 0 means not ranked',
            optional: true,
            nullable: true,
          },
          positionType: {
            type: 'string',
            description: 'Whether the position is a regular organic result or a SERP feature',
            optional: true,
            nullable: true,
          },
          domain: {
            type: 'string',
            description: 'Domain name',
            optional: true,
            nullable: true,
          },
          url: {
            type: 'string',
            description: 'URL of the ranking or advertised page',
            optional: true,
            nullable: true,
          },
          keywordSerpFeatures: {
            type: 'array',
            description: 'IDs of all SERP features triggered by the keyword',
            optional: true,
            items: { type: 'number' },
          },
          serpFeatures: {
            type: 'array',
            description: 'IDs of the SERP features the domain appears in for the keyword',
            optional: true,
            items: { type: 'number' },
          },
        },
      },
    },
  },
}
