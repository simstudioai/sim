import type {
  SemrushDomainAdCopiesParams,
  SemrushDomainAdCopiesResponse,
  SemrushDomainAdCopiesRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_ANALYTICS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['Tt', 'Ds', 'Vu', 'Ur', 'Pc'] as const

export const semrushDomainAdCopiesTool: ToolConfig<
  SemrushDomainAdCopiesParams,
  SemrushDomainAdCopiesResponse
> = {
  id: 'semrush_domain_ad_copies',
  name: 'Semrush Domain Ad Copies',
  description:
    'List the unique Google Ads creatives a domain runs, with title, description, and keyword count.',
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
      description: 'Sort order, for example pc_desc',
    },
    displayFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semrush display_filter expression, for example +|Tt|Co|sale',
    },
  },

  request: {
    url: (params) =>
      buildSemrushUrl(SEMRUSH_ANALYTICS_URL, {
        apiKey: params.apiKey,
        type: 'domain_adwords_unique',
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
    const rows = await readSemrushReport<SemrushDomainAdCopiesRow>(response, COLUMNS)

    return {
      success: true,
      output: { ads: rows },
    }
  },

  outputs: {
    ads: {
      type: 'array',
      description: 'Unique ad creatives the domain runs',
      items: {
        type: 'object',
        properties: {
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
          url: {
            type: 'string',
            description: 'URL of the ranking or advertised page',
            optional: true,
            nullable: true,
          },
          numberOfKeywords: {
            type: 'number',
            description: 'Number of keywords the ad runs on',
            optional: true,
            nullable: true,
          },
        },
      },
    },
  },
}
