import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookDealStockInfoTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_deal_stock_info',
  name: 'PitchBook Deal Stock Info',
  description:
    'Retrieve the share terms of a deal: price per share, shares acquired, and the preference, dividend, and voting rights attached',
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
    url: (params) => `${PITCHBOOK_API_BASE}/deals/${params.pbId.trim()}/stock-info`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch deal stock info')
    const data = await response.json()

    return {
      success: true,
      output: {
        dealId: data.dealId ?? null,
        dealNumber: data.dealNumber ?? null,
        companyId: data.companyId ?? null,
        companyName: data.companyName ?? null,
        series: data.series ?? null,
        pricePerShare: data.pricePerShare ?? null,
        stockType: data.stockType ?? null,
        numberOfSharesAcquired: data.numberOfSharesAcquired ?? null,
        sharesSought: data.sharesSought ?? null,
        conversionRatio: data.conversionRatio ?? null,
        liquidationPreferences: data.liquidationPreferences ?? null,
        liquidationParticipating: data.liquidationParticipating ?? null,
        dividendRights: data.dividendRights ?? null,
        cumulativeness: data.cumulativeness ?? null,
        antiDilutionProvisions: data.antiDilutionProvisions ?? null,
        redemptionRights: data.redemptionRights ?? null,
        boardVotingRights: data.boardVotingRights ?? null,
        generalVotingRights: data.generalVotingRights ?? null,
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
    companyId: { type: 'string', description: 'PitchBook company ID', nullable: true },
    companyName: { type: 'string', description: 'Company name', nullable: true },
    series: { type: 'string', description: 'Stock series', nullable: true },
    pricePerShare: {
      type: 'object',
      description: 'Price per share',
      properties: {
        amount: { type: 'number', description: 'Value in the requested currency' },
        currency: { type: 'string', description: 'Currency of amount' },
        nativeAmount: {
          type: 'number',
          description: 'Value in the currency it was originally reported in',
        },
        nativeCurrency: { type: 'string', description: 'Currency of nativeAmount' },
        estimated: { type: 'boolean', description: 'Whether the value is a PitchBook estimate' },
      },
    },
    stockType: { type: 'json', description: 'Type of stock', nullable: true },
    numberOfSharesAcquired: { type: 'number', description: 'Shares acquired', nullable: true },
    sharesSought: { type: 'number', description: 'Shares sought', nullable: true },
    conversionRatio: { type: 'string', description: 'Conversion ratio', nullable: true },
    liquidationPreferences: {
      type: 'string',
      description: 'Liquidation preference terms',
      nullable: true,
    },
    liquidationParticipating: {
      type: 'string',
      description: 'Whether the preference participates',
      nullable: true,
    },
    dividendRights: { type: 'string', description: 'Dividend rights terms', nullable: true },
    cumulativeness: {
      type: 'string',
      description: 'Whether dividends are cumulative',
      nullable: true,
    },
    antiDilutionProvisions: {
      type: 'string',
      description: 'Anti-dilution provisions',
      nullable: true,
    },
    redemptionRights: { type: 'json', description: 'Redemption rights terms', nullable: true },
    boardVotingRights: { type: 'string', description: 'Board voting rights terms', nullable: true },
    generalVotingRights: {
      type: 'string',
      description: 'General voting rights terms',
      nullable: true,
    },
  },
}
