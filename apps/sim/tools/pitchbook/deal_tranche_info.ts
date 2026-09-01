import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookDealTrancheInfoTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_deal_tranche_info',
  name: 'PitchBook Deal Tranche Info',
  description:
    'Retrieve the tranches a deal was funded in, with each tranche date, size, and investors',
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
      description: 'PitchBook deal ID, e.g. 52721-65T. Deal IDs end in T.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/deals/${params.pbId.trim()}/tranche-info`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch deal tranche information')
    const data = await response.json()

    return {
      success: true,
      output: {
        dealId: data.dealId ?? null,
        dealNumber: data.dealNumber ?? null,
        company: data.company ?? null,
        tranches: data.tranches ?? [],
      },
    }
  },

  outputs: {
    dealId: { type: 'string', description: 'PitchBook deal ID', nullable: true },
    dealNumber: {
      type: 'number',
      description: 'Sequence of the deal in the company financing history',
      nullable: true,
    },
    company: {
      type: 'object',
      description: 'Company the record belongs to',
      properties: {
        id: { type: 'string', description: 'PitchBook person ID' },
        name: { type: 'string', description: 'Name' },
      },
    },
    tranches: {
      type: 'array',
      description: 'Tranches making up the deal',
      items: {
        type: 'object',
        properties: {
          trancheSize: {
            type: 'object',
            description: 'Size of the tranche',
            nullable: true,
            properties: {
              nativeCurrency: { type: 'string', description: 'Currency of nativeAmount' },
              currency: { type: 'string', description: 'Currency of amount' },
              amount: { type: 'number', description: 'Value in the requested currency' },
              estimated: {
                type: 'boolean',
                description: 'Whether the value is a PitchBook estimate',
              },
              nativeAmount: {
                type: 'number',
                description: 'Value in the currency it was originally reported in',
              },
            },
          },
          trancheSizeStatus: {
            type: 'string',
            description: 'Whether the tranche size is actual or estimated',
          },
          trancheDate: { type: 'string', description: 'Date of the tranche (YYYY-MM-DD)' },
          financingType: {
            type: 'object',
            description: 'Type of financing',
            properties: {
              description: { type: 'string', description: 'Human-readable label for the code' },
              code: { type: 'string', description: 'PitchBook code' },
            },
          },
          stockType: {
            type: 'object',
            description: 'Type of stock',
            nullable: true,
            properties: {
              description: { type: 'string', description: 'Human-readable label for the code' },
              code: { type: 'string', description: 'PitchBook code' },
            },
          },
          stockSeriesType: { type: 'string', description: 'Type of the stock series' },
          conversionStatus: { type: 'json', description: 'Conversion status', nullable: true },
          conversionDate: {
            type: 'json',
            description: 'Conversion date (YYYY-MM-DD)',
            nullable: true,
          },
          investor: {
            type: 'object',
            description: 'Investor on the record',
            nullable: true,
            properties: {
              name: { type: 'string', description: 'Name' },
              id: { type: 'string', description: 'PitchBook person ID' },
            },
          },
          investor2: {
            type: 'object',
            description: 'Second investor on the record',
            nullable: true,
            properties: {
              id: { type: 'string', description: 'PitchBook person ID' },
              name: { type: 'string', description: 'Name' },
            },
          },
          investor3: {
            type: 'object',
            description: 'Third investor on the record',
            nullable: true,
            properties: {
              id: { type: 'string', description: 'PitchBook person ID' },
              name: { type: 'string', description: 'Name' },
            },
          },
        },
      },
    },
  },
}
