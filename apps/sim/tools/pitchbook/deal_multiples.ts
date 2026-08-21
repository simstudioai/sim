import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookDealMultiplesTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_deal_multiples',
  name: 'PitchBook Deal Multiples',
  description:
    'Retrieve the valuation multiples for a deal against revenue, EBITDA, EBIT, cash flow, and net income',
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
    url: (params) => `${PITCHBOOK_API_BASE}/deals/${params.pbId.trim()}/multiples`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch deal multiples')
    const data = await response.json()

    return {
      success: true,
      output: {
        dealId: data.dealId ?? null,
        dealNumber: data.dealNumber ?? null,
        companyId: data.companyId ?? null,
        companyName: data.companyName ?? null,
        dealSizeToCashFlow: data.dealSizeToCashFlow ?? null,
        dealSizeToEBIT: data.dealSizeToEBIT ?? null,
        dealSizeToEBITDA: data.dealSizeToEBITDA ?? null,
        dealSizeToNetIncome: data.dealSizeToNetIncome ?? null,
        dealSizeToRevenue: data.dealSizeToRevenue ?? null,
        debtRaisedInRoundToEBITDA: data.debtRaisedInRoundToEBITDA ?? null,
        debtRaisedInRoundToEquity: data.debtRaisedInRoundToEquity ?? null,
        impliedEvToCashFlow: data.impliedEvToCashFlow ?? null,
        impliedEvToEBIT: data.impliedEvToEBIT ?? null,
        impliedEvToEBITDA: data.impliedEvToEBITDA ?? null,
        impliedEvToNetIncome: data.impliedEvToNetIncome ?? null,
        impliedEvToRevenue: data.impliedEvToRevenue ?? null,
        valuationToCashFlow: data.valuationToCashFlow ?? null,
        valuationToEBIT: data.valuationToEBIT ?? null,
        valuationToEBITDA: data.valuationToEBITDA ?? null,
        valuationToNetIncome: data.valuationToNetIncome ?? null,
        valuationToRevenue: data.valuationToRevenue ?? null,
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
    dealSizeToCashFlow: { type: 'number', description: 'Deal size to cash flow', nullable: true },
    dealSizeToEBIT: { type: 'number', description: 'Deal size to EBIT', nullable: true },
    dealSizeToEBITDA: { type: 'number', description: 'Deal size to EBITDA', nullable: true },
    dealSizeToNetIncome: { type: 'json', description: 'Deal size to net income', nullable: true },
    dealSizeToRevenue: { type: 'number', description: 'Deal size to revenue', nullable: true },
    debtRaisedInRoundToEBITDA: {
      type: 'json',
      description: 'Debt raised in round to EBITDA',
      nullable: true,
    },
    debtRaisedInRoundToEquity: {
      type: 'json',
      description: 'Debt raised in round to equity',
      nullable: true,
    },
    impliedEvToCashFlow: { type: 'number', description: 'Implied EV to cash flow', nullable: true },
    impliedEvToEBIT: { type: 'number', description: 'Implied EV to EBIT', nullable: true },
    impliedEvToEBITDA: { type: 'number', description: 'Implied EV to EBITDA', nullable: true },
    impliedEvToNetIncome: { type: 'json', description: 'Implied EV to net income', nullable: true },
    impliedEvToRevenue: { type: 'number', description: 'Implied EV to revenue', nullable: true },
    valuationToCashFlow: { type: 'number', description: 'Valuation to cash flow', nullable: true },
    valuationToEBIT: { type: 'number', description: 'Valuation to EBIT', nullable: true },
    valuationToEBITDA: { type: 'number', description: 'Valuation to EBITDA', nullable: true },
    valuationToNetIncome: { type: 'json', description: 'Valuation to net income', nullable: true },
    valuationToRevenue: { type: 'number', description: 'Valuation to revenue', nullable: true },
  },
}
