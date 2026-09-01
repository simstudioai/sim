import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookInvestorLastClosedFundTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_investor_last_closed_fund',
  name: 'PitchBook Investor Last Closed Fund',
  description:
    'Retrieve the most recently closed fund raised by an investor, with its size, type, and vintage',
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
      description: 'PitchBook investor ID, e.g. 58781-35.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/investors/${params.pbId.trim()}/last-closed-fund`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch investor last closed fund')
    const data = await response.json()

    return {
      success: true,
      output: {
        investorId: data.investorId ?? null,
        fundId: data.fundId ?? null,
        fundName: data.fundName ?? null,
        fundVintage: data.fundVintage ?? null,
        fundSize: data.fundSize ?? null,
        fundType: data.fundType ?? null,
        fundCloseDate: data.fundCloseDate ?? null,
        fundOpenDate: data.fundOpenDate ?? null,
      },
    }
  },

  outputs: {
    investorId: { type: 'string', description: 'PitchBook investor ID', nullable: true },
    fundId: { type: 'string', description: 'PitchBook fund ID', nullable: true },
    fundName: { type: 'string', description: 'Fund name', nullable: true },
    fundVintage: { type: 'number', description: 'Vintage year of the fund', nullable: true },
    fundSize: {
      type: 'object',
      description: 'Capital raised by the fund',
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
    fundType: {
      type: 'object',
      description: 'Fund type',
      properties: {
        code: { type: 'string', description: 'PitchBook code' },
        description: { type: 'string', description: 'Human-readable label for the code' },
      },
    },
    fundCloseDate: {
      type: 'string',
      description: 'Date the fund closed (YYYY-MM-DD)',
      nullable: true,
    },
    fundOpenDate: {
      type: 'json',
      description: 'Date the fund opened (YYYY-MM-DD)',
      nullable: true,
    },
  },
}
