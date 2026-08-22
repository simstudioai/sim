import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookFundCashFlowsParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookFundCashFlowsTool: ToolConfig<
  PitchbookFundCashFlowsParams,
  PitchbookResponse
> = {
  id: 'pitchbook_fund_cash_flows',
  name: 'PitchBook Fund Cash Flows',
  description:
    'Retrieve contributed, distributed, and remaining value for a fund as of a specific quarter',
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
      description: 'PitchBook fund ID, e.g. 11373-13F. Fund IDs end in F.',
    },
    period: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reporting quarter to fetch, formatted as quarter then year, e.g. 4Q2018',
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
      `${PITCHBOOK_API_BASE}/funds/${params.pbId.trim()}/cashflows/${params.period.trim()}`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch fund cash flows')
    const data = await response.json()

    return {
      success: true,
      output: {
        fundId: data.fundId ?? null,
        fundName: data.fundName ?? null,
        asOfQuarter: data.asOfQuarter ?? null,
        asOfYear: data.asOfYear ?? null,
        contributed: data.contributed ?? null,
        percentCalledDown: data.percentCalledDown ?? null,
        dryPowder: data.dryPowder ?? null,
        percentDryPowder: data.percentDryPowder ?? null,
        distributed: data.distributed ?? null,
        remainingValue: data.remainingValue ?? null,
        distributedRemaining: data.distributedRemaining ?? null,
      },
    }
  },

  outputs: {
    fundId: { type: 'string', description: 'PitchBook fund ID', nullable: true },
    fundName: { type: 'string', description: 'Fund name', nullable: true },
    asOfQuarter: {
      type: 'number',
      description: 'Quarter the figures are reported as of',
      nullable: true,
    },
    asOfYear: {
      type: 'number',
      description: 'Year the figures are reported as of',
      nullable: true,
    },
    contributed: {
      type: 'object',
      description: 'Capital contributed by limited partners',
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
    percentCalledDown: {
      type: 'number',
      description: 'Percentage of committed capital called down',
      nullable: true,
    },
    dryPowder: {
      type: 'object',
      description: 'Uncalled capital available to deploy',
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
    percentDryPowder: {
      type: 'number',
      description: 'Percentage of committed capital still uncalled',
      nullable: true,
    },
    distributed: {
      type: 'object',
      description: 'Capital distributed back to limited partners',
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
    remainingValue: {
      type: 'object',
      description: 'Remaining value held in the fund',
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
    distributedRemaining: {
      type: 'object',
      description: 'Distributed plus remaining value',
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
  },
}
