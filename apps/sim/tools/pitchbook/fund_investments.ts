import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookFundInvestmentsTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_fund_investments',
  name: 'PitchBook Fund Investments',
  description:
    'Retrieve every investment a fund has made, active and exited, with the deals that opened and closed each position',
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
    url: (params) => `${PITCHBOOK_API_BASE}/funds/${params.pbId.trim()}/investments`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch fund investments')
    const data = await response.json()

    return {
      success: true,
      output: {
        fundId: data.fundId ?? null,
        fundName: data.fundName ?? null,
        investments: data.investments ?? [],
      },
    }
  },

  outputs: {
    fundId: { type: 'string', description: 'PitchBook fund ID', nullable: true },
    fundName: { type: 'string', description: 'Fund name', nullable: true },
    investments: {
      type: 'array',
      description: 'Investments held',
      items: {
        type: 'object',
        properties: {
          targetCompanyId: { type: 'string', description: 'PitchBook ID of the portfolio company' },
          targetCompanyName: { type: 'string', description: 'Name of the portfolio company' },
          investmentStatus: {
            type: 'string',
            description: 'Whether the position is active or exited',
          },
          targetCompanyInvestmentDate: {
            type: 'string',
            description: 'Date the position was opened (YYYY-MM-DD)',
          },
          investmentDealId: { type: 'string', description: 'PitchBook deal ID of the investment' },
          targetCompanyExitDate: {
            type: 'string',
            description: 'Date the position was exited (YYYY-MM-DD)',
            nullable: true,
          },
          exitDealId: {
            type: 'string',
            description: 'PitchBook deal ID of the exit',
            nullable: true,
          },
        },
      },
    },
  },
}
