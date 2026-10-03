import type {
  SemrushDomainPaidCompetitorsParams,
  SemrushDomainPaidCompetitorsResponse,
  SemrushDomainPaidCompetitorsRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_ANALYTICS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['Dn', 'Cr', 'Np', 'Ad', 'At', 'Ac', 'Or'] as const

export const semrushDomainPaidCompetitorsTool: ToolConfig<
  SemrushDomainPaidCompetitorsParams,
  SemrushDomainPaidCompetitorsResponse
> = {
  id: 'semrush_domain_paid_competitors',
  name: 'Semrush Paid Competitors',
  description: 'List the domains competing with a target domain in Google paid search results.',
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
    displayDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Historical month in YYYYMM15 format',
    },
    displaySort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order, for example np_desc or cr_desc',
    },
  },

  request: {
    url: (params) =>
      buildSemrushUrl(SEMRUSH_ANALYTICS_URL, {
        apiKey: params.apiKey,
        type: 'domain_adwords_adwords',
        columnCodes: COLUMNS,
        extra: {
          domain: params.domain,
          database: params.database,
          display_limit: normalizeLimit(params.limit, 50),
          display_offset: params.offset,
          display_date: params.displayDate,
          display_sort: params.displaySort,
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushDomainPaidCompetitorsRow>(response, COLUMNS)

    return {
      success: true,
      output: { competitors: rows },
    }
  },

  outputs: {
    competitors: {
      type: 'array',
      description: 'Competing advertisers ranked by competitor relevance',
      items: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            description: 'Domain name',
            optional: true,
            nullable: true,
          },
          competitorRelevance: {
            type: 'number',
            description: 'Competition level based on the total keyword count of each domain',
            optional: true,
            nullable: true,
          },
          commonKeywords: {
            type: 'number',
            description: 'Keywords both domains rank for in the top 100 organic results',
            optional: true,
            nullable: true,
          },
          paidKeywords: {
            type: 'number',
            description: 'Keywords this competing domain is buying in Google Ads',
            optional: true,
            nullable: true,
          },
          paidTraffic: {
            type: 'number',
            description: 'Traffic this competing domain gets from paid search results',
            optional: true,
            nullable: true,
          },
          paidCost: {
            type: 'number',
            description: 'Estimated monthly Google Ads budget of this competing domain',
            optional: true,
            nullable: true,
          },
          organicKeywords: {
            type: 'number',
            description:
              'Keywords this competing domain ranks for in the Google top 100 organic results',
            optional: true,
            nullable: true,
          },
        },
      },
    },
  },
}
