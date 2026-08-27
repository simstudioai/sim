import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookDealCapTableHistoryTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_deal_cap_table_history',
  name: 'PitchBook Deal Cap Table History',
  description:
    'Retrieve the cap table as of a deal, one row per stock series with its terms and ownership',
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
    url: (params) => `${PITCHBOOK_API_BASE}/deals/${params.pbId.trim()}/cap-table-history`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch deal cap table history')
    const data = await response.json()

    return {
      success: true,
      output: {
        capTable: Array.isArray(data) ? data : [],
      },
    }
  },

  outputs: {
    capTable: {
      type: 'array',
      description: 'Stock series on the cap table as of the deal',
      items: {
        type: 'object',
        properties: {
          dealId: { type: 'string', description: 'PitchBook deal ID' },
          dealNumber: {
            type: 'number',
            description: 'Sequence of the deal in the company financing history',
          },
          companyId: { type: 'string', description: 'PitchBook company ID' },
          companyName: { type: 'string', description: 'Company name' },
          stockSeries: { type: 'string', description: 'Stock series' },
          numberOfSharesAuthorized: { type: 'number', description: 'Shares authorized' },
          parValue: {
            type: 'object',
            description: 'Par value per share',
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
          dividendRate: { type: 'number', description: 'Dividend rate' },
          dividendAmount: { type: 'json', description: 'Dividend amount', nullable: true },
          originalIssuePrice: {
            type: 'object',
            description: 'Original issue price per share',
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
          liquidationPrice: {
            type: 'object',
            description: 'Liquidation price per share',
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
          liquidationPreferenceMultiple: {
            type: 'number',
            description: 'Liquidation preference multiple',
          },
          conversionPrice: {
            type: 'object',
            description: 'Conversion price per share',
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
          percentOwned: { type: 'number', description: 'Percentage owned' },
        },
      },
    },
  },
}
