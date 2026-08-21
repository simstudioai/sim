import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookFundActiveInvestmentsTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_fund_active_investments',
  name: 'PitchBook Fund Active Investments',
  description: 'Retrieve only the portfolio positions a fund still holds',
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
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO currency code to convert monetary values into, sent as the X-Currency header (e.g. USD, EUR, JPY). Defaults to the currency on the account preferences.',
    },
  },

  request: {
    url: (params) => `${PITCHBOOK_API_BASE}/funds/${params.pbId.trim()}/active-investments`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch fund active investments')
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
      description: 'Portfolio positions the fund still holds',
      items: {
        type: 'object',
        properties: {
          fundId: { type: 'string', description: 'PitchBook fund ID' },
          targetCompanyId: { type: 'string', description: 'PitchBook ID of the portfolio company' },
          targetCompanyName: { type: 'string', description: 'Name of the portfolio company' },
          targetCompanyInvestmentDate: {
            type: 'string',
            description: 'Date the position was opened (YYYY-MM-DD)',
          },
          investmentDealId: { type: 'string', description: 'PitchBook deal ID of the investment' },
        },
      },
    },
  },
}
