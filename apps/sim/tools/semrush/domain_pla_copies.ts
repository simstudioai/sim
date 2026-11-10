import type {
  SemrushDomainPlaCopiesParams,
  SemrushDomainPlaCopiesResponse,
  SemrushDomainPlaCopiesRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_ANALYTICS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['Tt', 'Pr', 'Sn', 'Ur'] as const

export const semrushDomainPlaCopiesTool: ToolConfig<
  SemrushDomainPlaCopiesParams,
  SemrushDomainPlaCopiesResponse
> = {
  id: 'semrush_domain_pla_copies',
  name: 'Semrush Domain PLA Copies',
  description:
    'List the unique product listing ads a domain runs, with product title, price, and shop name.',
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
  },

  request: {
    url: (params) =>
      buildSemrushUrl(SEMRUSH_ANALYTICS_URL, {
        apiKey: params.apiKey,
        type: 'domain_shopping_unique',
        columnCodes: COLUMNS,
        extra: {
          domain: params.domain,
          database: params.database,
          display_limit: normalizeLimit(params.limit, 50),
          display_offset: params.offset,
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushDomainPlaCopiesRow>(response, COLUMNS)

    return {
      success: true,
      output: { ads: rows },
    }
  },

  outputs: {
    ads: {
      type: 'array',
      description: 'Unique product listing ads the domain runs',
      items: {
        type: 'object',
        properties: {
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
        },
      },
    },
  },
}
