import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookDealInvestorsTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_deal_investors',
  name: 'PitchBook Deal Investors',
  description:
    'Retrieve the investors, sellers, and exiting investors on a deal, including who led it',
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
      description:
        'PitchBook deal ID, e.g. 52721-65T. Deal IDs end in T and come from a deal search or a company deals lookup.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/deals/${params.pbId.trim()}/investors/exiters`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch deal investors')
    const data = await response.json()

    return {
      success: true,
      output: {
        dealId: data.dealId ?? null,
        companyId: data.companyId ?? null,
        companyName: data.companyName ?? null,
        investors: data.investors ?? [],
        sellers: data.sellers ?? [],
        exiters: data.exiters ?? [],
      },
    }
  },

  outputs: {
    dealId: { type: 'string', description: 'PitchBook deal ID', nullable: true },
    companyId: {
      type: 'string',
      description: 'PitchBook ID of the company in the deal',
      nullable: true,
    },
    companyName: { type: 'string', description: 'Name of the company in the deal', nullable: true },
    investors: {
      type: 'array',
      description: 'Investors participating in the deal',
      items: {
        type: 'object',
        properties: {
          investorId: { type: 'string', description: 'PitchBook investor ID' },
          investorName: { type: 'string', description: 'Investor name' },
          investmentStatus: {
            type: 'string',
            description: 'Whether the investor is new or following on',
            nullable: true,
          },
          leadSoleInvestor: {
            type: 'boolean',
            description: 'Whether the investor led or solely funded the round',
          },
          leadPartnerId: {
            type: 'string',
            description: 'PitchBook person ID of the lead partner',
            nullable: true,
          },
          leadPartnerName: {
            type: 'string',
            description: 'Name of the lead partner',
            nullable: true,
          },
          investorFunds: {
            type: 'array',
            description: 'Funds the investor deployed into the deal',
            items: {
              type: 'object',
              properties: {
                fundId: { type: 'string', description: 'PitchBook fund ID' },
                fundName: { type: 'string', description: 'Fund name' },
              },
            },
          },
          investmentAmount: {
            type: 'object',
            description: 'Amount this investor put into the deal',
            nullable: true,
            properties: {
              amount: {
                type: 'number',
                description: 'Value in the requested currency',
                nullable: true,
              },
              currency: { type: 'string', description: 'Currency of amount', nullable: true },
              nativeAmount: {
                type: 'number',
                description: 'Value in the currency it was originally reported in',
                nullable: true,
              },
              nativeCurrency: {
                type: 'string',
                description: 'Currency of nativeAmount',
                nullable: true,
              },
              estimated: {
                type: 'boolean',
                description: 'Whether the value is a PitchBook estimate',
              },
            },
          },
          formOfPayment: {
            type: 'object',
            description: 'How the investment was paid',
            nullable: true,
            properties: {
              code: { type: 'string', description: 'Payment form code', nullable: true },
              description: { type: 'string', description: 'Payment form label', nullable: true },
            },
          },
        },
      },
    },
    sellers: {
      type: 'array',
      description: 'Parties selling in the deal',
      items: { type: 'object' },
    },
    exiters: {
      type: 'array',
      description: 'Investors exiting through the deal',
      items: { type: 'object' },
    },
  },
}
