import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookInvestorFundsTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_investor_funds',
  name: 'PitchBook Investor Funds',
  description:
    'Retrieve the funds an investor manages, with open and closed counts and the min, median, and max fund size',
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
        'PitchBook investor ID, e.g. 58781-35. Use PitchBook Search to resolve a name to an ID.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/investors/${params.pbId.trim()}/funds`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch investor funds')
    const data = await response.json()

    return {
      success: true,
      output: {
        investorId: data.investorId ?? null,
        stats: data.stats ?? null,
        minFundSize: data.minFundSize ?? null,
        medianFundSize: data.medianFundSize ?? null,
        maxFundSize: data.maxFundSize ?? null,
        fundInfo: data.fundInfo ?? [],
      },
    }
  },

  outputs: {
    investorId: { type: 'string', description: 'PitchBook investor ID', nullable: true },
    stats: {
      type: 'object',
      description: 'Counts of open and closed funds',
      nullable: true,
      properties: {
        totalFundsOpen: { type: 'number', description: 'Number of open funds' },
        totalFundsClosed: { type: 'number', description: 'Number of closed funds' },
      },
    },
    minFundSize: {
      type: 'object',
      description: 'Smallest fund raised',
      nullable: true,
      properties: {
        amount: { type: 'number', description: 'Value in the requested currency', nullable: true },
        currency: { type: 'string', description: 'Currency of amount', nullable: true },
        nativeAmount: {
          type: 'number',
          description: 'Value in the currency it was originally reported in',
          nullable: true,
        },
        nativeCurrency: { type: 'string', description: 'Currency of nativeAmount', nullable: true },
        estimated: { type: 'boolean', description: 'Whether the value is a PitchBook estimate' },
      },
    },
    medianFundSize: {
      type: 'object',
      description: 'Median fund size',
      nullable: true,
      properties: {
        amount: { type: 'number', description: 'Value in the requested currency', nullable: true },
        currency: { type: 'string', description: 'Currency of amount', nullable: true },
        nativeAmount: {
          type: 'number',
          description: 'Value in the currency it was originally reported in',
          nullable: true,
        },
        nativeCurrency: { type: 'string', description: 'Currency of nativeAmount', nullable: true },
        estimated: { type: 'boolean', description: 'Whether the value is a PitchBook estimate' },
      },
    },
    maxFundSize: {
      type: 'object',
      description: 'Largest fund raised',
      nullable: true,
      properties: {
        amount: { type: 'number', description: 'Value in the requested currency', nullable: true },
        currency: { type: 'string', description: 'Currency of amount', nullable: true },
        nativeAmount: {
          type: 'number',
          description: 'Value in the currency it was originally reported in',
          nullable: true,
        },
        nativeCurrency: { type: 'string', description: 'Currency of nativeAmount', nullable: true },
        estimated: { type: 'boolean', description: 'Whether the value is a PitchBook estimate' },
      },
    },
    fundInfo: {
      type: 'array',
      description: 'Funds the investor manages',
      items: {
        type: 'object',
        properties: {
          fundId: { type: 'string', description: 'PitchBook fund ID' },
          fundName: { type: 'string', description: 'Fund name' },
          fundType: {
            type: 'object',
            description: 'Type of the fund',
            nullable: true,
            properties: {
              code: { type: 'string', description: 'Fund type code', nullable: true },
              description: { type: 'string', description: 'Fund type label', nullable: true },
            },
          },
        },
      },
    },
  },
}
