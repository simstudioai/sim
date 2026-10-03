import type {
  SemrushDomainOverviewParams,
  SemrushDomainOverviewResponse,
  SemrushDomainOverviewRow,
} from '@/tools/semrush/types'
import { buildSemrushUrl, readSemrushReport, SEMRUSH_ANALYTICS_URL } from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['Dn', 'Rk', 'Or', 'Ot', 'Oc', 'Ad', 'At', 'Ac'] as const

export const semrushDomainOverviewTool: ToolConfig<
  SemrushDomainOverviewParams,
  SemrushDomainOverviewResponse
> = {
  id: 'semrush_domain_overview',
  name: 'Semrush Domain Overview',
  description:
    'Get the Semrush rank plus organic and paid search totals for a domain in one regional database.',
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
        type: 'domain_rank',
        columnCodes: COLUMNS,
        extra: {
          domain: params.domain,
          database: params.database,
          display_date: params.displayDate,
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushDomainOverviewRow>(response, COLUMNS)

    return {
      success: true,
      output: { overview: rows[0] ?? null },
    }
  },

  outputs: {
    overview: {
      type: 'json',
      description: 'Organic and paid search overview for the domain',
      nullable: true,
      properties: {
        domain: {
          type: 'string',
          description: 'Domain name',
          optional: true,
          nullable: true,
        },
        rank: {
          type: 'number',
          description: 'Semrush popularity rating of the target, based on organic traffic',
          optional: true,
          nullable: true,
        },
        organicKeywords: {
          type: 'number',
          description: 'Keywords bringing users via the Google top 100 organic results',
          optional: true,
          nullable: true,
        },
        organicTraffic: {
          type: 'number',
          description: 'Traffic brought via the Google top 100 organic results',
          optional: true,
          nullable: true,
        },
        organicCost: {
          type: 'number',
          description: 'Estimated Google Ads price of the organic keywords',
          optional: true,
          nullable: true,
        },
        paidKeywords: {
          type: 'number',
          description: 'Keywords the target is buying in Google Ads',
          optional: true,
          nullable: true,
        },
        paidTraffic: {
          type: 'number',
          description: 'Traffic brought via paid search results',
          optional: true,
          nullable: true,
        },
        paidCost: {
          type: 'number',
          description: 'Estimated monthly Google Ads budget',
          optional: true,
          nullable: true,
        },
      },
    },
  },
}
