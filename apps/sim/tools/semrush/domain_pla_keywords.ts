import type {
  SemrushDomainPlaKeywordsParams,
  SemrushDomainPlaKeywordsResponse,
  SemrushDomainPlaKeywordsRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_ANALYTICS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['Ph', 'Po', 'Pp', 'Pd', 'Nq', 'Sn', 'Ur', 'Tt', 'Pr', 'Ts'] as const

export const semrushDomainPlaKeywordsTool: ToolConfig<
  SemrushDomainPlaKeywordsParams,
  SemrushDomainPlaKeywordsResponse
> = {
  id: 'semrush_domain_pla_keywords',
  name: 'Semrush Domain PLA Keywords',
  description:
    'List the keywords that trigger a domain product listing ads, with the promoted product and price.',
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
      description: 'Sort order, for example nq_desc or po_asc',
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
        type: 'domain_shopping',
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
    const rows = await readSemrushReport<SemrushDomainPlaKeywordsRow>(response, COLUMNS)

    return {
      success: true,
      output: { keywords: rows },
    }
  },

  outputs: {
    keywords: {
      type: 'array',
      description: 'Product listing ad keywords for the domain',
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
          shopName: {
            type: 'string',
            description: 'Name of the shop running the product listing ad',
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
          productPrice: {
            type: 'number',
            description: 'Price of the promoted product',
            optional: true,
            nullable: true,
          },
          timestamp: {
            type: 'number',
            description: 'Unix timestamp of the data point',
            optional: true,
            nullable: true,
          },
        },
      },
    },
  },
}
