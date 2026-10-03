import type {
  SemrushPaidResultsParams,
  SemrushPaidResultsResponse,
  SemrushPaidResultsRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_ANALYTICS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['Dn', 'Ur', 'Vu'] as const

export const semrushPaidResultsTool: ToolConfig<
  SemrushPaidResultsParams,
  SemrushPaidResultsResponse
> = {
  id: 'semrush_paid_results',
  name: 'Semrush Paid Results',
  description: 'List the domains and URLs advertising on a keyword in Google paid search results.',
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
        type: 'phrase_adwords',
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
    const rows = await readSemrushReport<SemrushPaidResultsRow>(response, COLUMNS)

    return {
      success: true,
      output: { results: rows },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Advertisers appearing for the keyword',
      items: {
        type: 'object',
        properties: {
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
