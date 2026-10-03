import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookInvestorActiveInvestmentsTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_investor_active_investments',
  name: 'PitchBook Investor Active Investments',
  description: 'Retrieve only the positions an investor still holds',
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
    url: (params) => `${PITCHBOOK_API_BASE}/investors/${params.pbId.trim()}/active-investments`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch investor active investments')
    const data = await response.json()

    return {
      success: true,
      output: {
        activeInvestments: Array.isArray(data) ? data : [],
      },
    }
  },

  outputs: {
    activeInvestments: {
      type: 'array',
      description: 'Positions the investor still holds',
      items: {
        type: 'object',
        properties: {
          investorId: { type: 'string', description: 'PitchBook investor ID' },
          companyId: { type: 'string', description: 'PitchBook company ID' },
          companyName: { type: 'string', description: 'Company name' },
          investorSince: {
            type: 'string',
            description: 'Date the investor first invested (YYYY-MM-DD)',
          },
          investmentDealId: { type: 'string', description: 'PitchBook deal ID of the investment' },
          investmentDate: {
            type: 'string',
            description: 'Date the position was opened (YYYY-MM-DD)',
          },
        },
      },
    },
  },
}
