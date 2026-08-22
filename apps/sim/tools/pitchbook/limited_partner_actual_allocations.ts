import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookLimitedPartnerActualAllocationsTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_limited_partner_actual_allocations',
  name: 'PitchBook Limited Partner Actual Allocations',
  description:
    'Retrieve a limited partner reported asset allocation across cash, equities, fixed income, private equity, real estate, and alternatives',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    pbId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PitchBook limited partner ID, e.g. 58901-50.',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO currency code to convert monetary values into, sent as the X-Currency header (e.g. USD, EUR, JPY). Defaults to the currency on the account preferences.',
    },
  },

  request: {
    url: (params) =>
      `${PITCHBOOK_API_BASE}/limited-partners/${params.pbId.trim()}/actual-allocations`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch limited partner actual allocations')
    const data = await response.json()

    return {
      success: true,
      output: {
        limitedPartnerId: data.limitedPartnerId ?? null,
        limitedPartnerName: data.limitedPartnerName ?? null,
        affiliatedFunds: data.affiliatedFunds ?? null,
        affiliatedInvestors: data.affiliatedInvestors ?? null,
        allocations: data.allocations ?? [],
      },
    }
  },

  outputs: {
    limitedPartnerId: {
      type: 'string',
      description: 'PitchBook limited partner ID',
      nullable: true,
    },
    limitedPartnerName: { type: 'string', description: 'Limited partner name', nullable: true },
    affiliatedFunds: { type: 'number', description: 'Number of affiliated funds', nullable: true },
    affiliatedInvestors: {
      type: 'number',
      description: 'Number of affiliated investors',
      nullable: true,
    },
    allocations: {
      type: 'array',
      description: 'Reported asset allocations',
      items: {
        type: 'object',
        properties: {
          alternativeInvestments: {
            type: 'json',
            description: 'Amount allocated to alternative investments',
            nullable: true,
          },
          alternativeInvestmentsPercent: {
            type: 'json',
            description: 'Percentage of the portfolio allocated to alternative investments',
            nullable: true,
          },
          privateEquity: {
            type: 'object',
            description: 'Amount allocated to private equity',
            properties: {
              amount: { type: 'number', description: 'Value in the requested currency' },
              currency: { type: 'string', description: 'Currency of amount' },
              nativeAmount: {
                type: 'number',
                description: 'Value in the currency it was originally reported in',
              },
              nativeCurrency: { type: 'string', description: 'Currency of nativeAmount' },
              estimated: {
                type: 'boolean',
                description: 'Whether the value is a PitchBook estimate',
              },
            },
          },
          privateEquityPercent: {
            type: 'number',
            description: 'Percentage of the portfolio allocated to private equity',
          },
          realEstate: {
            type: 'object',
            description: 'Amount allocated to real estate',
            properties: {
              amount: { type: 'number', description: 'Value in the requested currency' },
              currency: { type: 'string', description: 'Currency of amount' },
              nativeAmount: {
                type: 'number',
                description: 'Value in the currency it was originally reported in',
              },
              nativeCurrency: { type: 'string', description: 'Currency of nativeAmount' },
              estimated: {
                type: 'boolean',
                description: 'Whether the value is a PitchBook estimate',
              },
            },
          },
          realEstatePercent: {
            type: 'number',
            description: 'Percentage of the portfolio allocated to real estate',
          },
          specialOpportunities: {
            type: 'json',
            description: 'Amount allocated to special opportunities',
            nullable: true,
          },
          specialOpportunitiePercent: {
            type: 'json',
            description: 'Percentage of the portfolio allocated to special opportunities',
            nullable: true,
          },
          hedgeFunds: {
            type: 'object',
            description: 'Amount allocated to hedge funds',
            properties: {
              amount: { type: 'number', description: 'Value in the requested currency' },
              currency: { type: 'string', description: 'Currency of amount' },
              nativeAmount: {
                type: 'number',
                description: 'Value in the currency it was originally reported in',
              },
              nativeCurrency: { type: 'string', description: 'Currency of nativeAmount' },
              estimated: {
                type: 'boolean',
                description: 'Whether the value is a PitchBook estimate',
              },
            },
          },
          hedgeFundsPercent: {
            type: 'number',
            description: 'Percentage of the portfolio allocated to hedge funds',
          },
          equities: {
            type: 'object',
            description: 'Amount allocated to equities',
            properties: {
              amount: { type: 'number', description: 'Value in the requested currency' },
              currency: { type: 'string', description: 'Currency of amount' },
              nativeAmount: {
                type: 'number',
                description: 'Value in the currency it was originally reported in',
              },
              nativeCurrency: { type: 'string', description: 'Currency of nativeAmount' },
              estimated: {
                type: 'boolean',
                description: 'Whether the value is a PitchBook estimate',
              },
            },
          },
          equitiesPercent: {
            type: 'number',
            description: 'Percentage of the portfolio allocated to equities',
          },
          fixedIncome: {
            type: 'object',
            description: 'Amount allocated to fixed income',
            properties: {
              amount: { type: 'number', description: 'Value in the requested currency' },
              currency: { type: 'string', description: 'Currency of amount' },
              nativeAmount: {
                type: 'number',
                description: 'Value in the currency it was originally reported in',
              },
              nativeCurrency: { type: 'string', description: 'Currency of nativeAmount' },
              estimated: {
                type: 'boolean',
                description: 'Whether the value is a PitchBook estimate',
              },
            },
          },
          fixedIncomePercent: {
            type: 'number',
            description: 'Percentage of the portfolio allocated to fixed income',
          },
          cash: {
            type: 'object',
            description: 'Amount allocated to cash',
            properties: {
              amount: { type: 'number', description: 'Value in the requested currency' },
              currency: { type: 'string', description: 'Currency of amount' },
              nativeAmount: {
                type: 'number',
                description: 'Value in the currency it was originally reported in',
              },
              nativeCurrency: { type: 'string', description: 'Currency of nativeAmount' },
              estimated: {
                type: 'boolean',
                description: 'Whether the value is a PitchBook estimate',
              },
            },
          },
          cashPercent: {
            type: 'number',
            description: 'Percentage of the portfolio allocated to cash',
          },
        },
      },
    },
  },
}
