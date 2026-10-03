import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookLimitedPartnerTargetAllocationsTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_limited_partner_target_allocations',
  name: 'PitchBook Limited Partner Target Allocations',
  description:
    'Retrieve a limited partner target allocation ranges per asset class, in both value and percentage terms',
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
      `${PITCHBOOK_API_BASE}/limited-partners/${params.pbId.trim()}/target-allocations`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch limited partner target allocations')
    const data = await response.json()

    return {
      success: true,
      output: {
        limitedPartnerId: data.limitedPartnerId ?? null,
        limitedPartnerName: data.limitedPartnerName ?? null,
        targetAllocations: data.targetAllocations ?? [],
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
    targetAllocations: {
      type: 'array',
      description: 'Target asset allocations',
      items: {
        type: 'object',
        properties: {
          policyDescription: { type: 'string', description: 'Allocation policy description' },
          alternativesMin: { type: 'json', description: 'Alternatives min', nullable: true },
          alternativesPercentMin: {
            type: 'json',
            description: 'Alternatives percent min',
            nullable: true,
          },
          alternativesMax: { type: 'json', description: 'Alternatives max', nullable: true },
          alternativesPercentMax: {
            type: 'json',
            description: 'Alternatives percent max',
            nullable: true,
          },
          privateEquityMin: {
            type: 'object',
            description: 'Minimum target allocation to private equity',
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
          privateEquityPercentMin: {
            type: 'number',
            description: 'Minimum target allocation to private equity, as a percentage',
          },
          privateEquityMax: {
            type: 'object',
            description: 'Maximum target allocation to private equity',
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
          privateEquityPercentMax: {
            type: 'number',
            description: 'Maximum target allocation to private equity, as a percentage',
          },
          realEstateMin: {
            type: 'object',
            description: 'Minimum target allocation to real estate',
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
          realEstatePercentMin: {
            type: 'number',
            description: 'Minimum target allocation to real estate, as a percentage',
          },
          realEstateMax: {
            type: 'object',
            description: 'Maximum target allocation to real estate',
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
          realEstatePercentMax: {
            type: 'number',
            description: 'Maximum target allocation to real estate, as a percentage',
          },
          specialOpportunitiesMin: {
            type: 'json',
            description: 'Minimum target allocation to special opportunities',
            nullable: true,
          },
          specialOpportunitiesPercentMin: {
            type: 'json',
            description: 'Minimum target allocation to special opportunities, as a percentage',
            nullable: true,
          },
          specialOpportunitiesMax: {
            type: 'json',
            description: 'Maximum target allocation to special opportunities',
            nullable: true,
          },
          specialOpportunitiesPercentMax: {
            type: 'json',
            description: 'Maximum target allocation to special opportunities, as a percentage',
            nullable: true,
          },
          hedgeFundsMin: {
            type: 'json',
            description: 'Minimum target allocation to hedge funds',
            nullable: true,
          },
          hedgeFundsPercentMin: {
            type: 'json',
            description: 'Minimum target allocation to hedge funds, as a percentage',
            nullable: true,
          },
          hedgeFundsMax: {
            type: 'json',
            description: 'Maximum target allocation to hedge funds',
            nullable: true,
          },
          hedgeFundsPercentMax: {
            type: 'json',
            description: 'Maximum target allocation to hedge funds, as a percentage',
            nullable: true,
          },
          equitiesMin: {
            type: 'object',
            description: 'Minimum target allocation to equities',
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
          equitiesPercentMin: {
            type: 'number',
            description: 'Minimum target allocation to equities, as a percentage',
          },
          equitiesMax: {
            type: 'object',
            description: 'Maximum target allocation to equities',
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
          equitiesPercentMax: {
            type: 'number',
            description: 'Maximum target allocation to equities, as a percentage',
          },
          fixedIncomeMin: {
            type: 'object',
            description: 'Minimum target allocation to fixed income',
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
          fixedIncomePercentMin: {
            type: 'number',
            description: 'Minimum target allocation to fixed income, as a percentage',
          },
          fixedIncomeMax: {
            type: 'object',
            description: 'Maximum target allocation to fixed income',
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
          fixedIncomePercentMax: {
            type: 'number',
            description: 'Maximum target allocation to fixed income, as a percentage',
          },
          cashMin: {
            type: 'json',
            description: 'Minimum target allocation to cash',
            nullable: true,
          },
          cashPercentMin: {
            type: 'json',
            description: 'Minimum target allocation to cash, as a percentage',
            nullable: true,
          },
          cashMax: {
            type: 'json',
            description: 'Maximum target allocation to cash',
            nullable: true,
          },
          cashPercentMax: {
            type: 'json',
            description: 'Maximum target allocation to cash, as a percentage',
            nullable: true,
          },
        },
      },
    },
  },
}
