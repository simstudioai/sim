import type { EnrichCompanyFundingParams, EnrichCompanyFundingResponse } from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const companyFundingTool: ToolConfig<
  EnrichCompanyFundingParams,
  EnrichCompanyFundingResponse
> = {
  id: 'enrich_company_funding',
  name: 'Enrich Company Funding',
  description:
    'Retrieve company funding history, traffic metrics, and executive information by domain.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company domain (e.g., example.com)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/company-funding-plus')
      url.searchParams.append('domain', params.domain.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const resultData = data.data ?? data

    const fundingRounds =
      (resultData.fundingRounds ?? resultData.funding_rounds)?.map((round: any) => ({
        roundType: round.roundType ?? round.round_type ?? '',
        amount: round.amount ?? null,
        date: round.date ?? null,
        investors: round.investors ?? [],
      })) ?? []

    const executives = (resultData.executives ?? []).map((exec: any) => ({
      name: exec.name ?? exec.fullName ?? '',
      title: exec.title ?? '',
    }))

    return {
      success: true,
      output: {
        legalName: resultData.legalName ?? resultData.legal_name ?? null,
        employeeCount: resultData.employeeCount ?? resultData.employee_count ?? null,
        headquarters: resultData.headquarters ?? null,
        industry: resultData.industry ?? null,
        totalFundingRaised:
          resultData.totalFundingRaised ?? resultData.total_funding_raised ?? null,
        fundingRounds,
        monthlyVisits: resultData.monthlyVisits ?? resultData.monthly_visits ?? null,
        trafficChange: resultData.trafficChange ?? resultData.traffic_change ?? null,
        itSpending: resultData.itSpending ?? resultData.it_spending ?? null,
        executives,
      },
    }
  },

  outputs: {
    legalName: {
      type: 'string',
      description: 'Legal company name',
      optional: true,
    },
    employeeCount: {
      type: 'number',
      description: 'Number of employees',
      optional: true,
    },
    headquarters: {
      type: 'string',
      description: 'Headquarters location',
      optional: true,
    },
    industry: {
      type: 'string',
      description: 'Industry',
      optional: true,
    },
    totalFundingRaised: {
      type: 'number',
      description: 'Total funding raised',
      optional: true,
    },
    fundingRounds: {
      type: 'array',
      description: 'Funding rounds',
      items: {
        type: 'object',
        properties: {
          roundType: { type: 'string', description: 'Round type' },
          amount: { type: 'number', description: 'Amount raised' },
          date: { type: 'string', description: 'Date' },
          investors: { type: 'array', description: 'Investors' },
        },
      },
    },
    monthlyVisits: {
      type: 'number',
      description: 'Monthly website visits',
      optional: true,
    },
    trafficChange: {
      type: 'number',
      description: 'Traffic change percentage',
      optional: true,
    },
    itSpending: {
      type: 'number',
      description: 'Estimated IT spending in USD',
      optional: true,
    },
    executives: {
      type: 'array',
      description: 'Executive team',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name' },
          title: { type: 'string', description: 'Title' },
        },
      },
    },
  },
}
