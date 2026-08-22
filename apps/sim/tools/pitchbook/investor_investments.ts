import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookInvestorInvestmentsTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_investor_investments',
  name: 'PitchBook Investor Investments',
  description:
    'Retrieve every investment an investor has made, active and exited, with the deals that opened and closed each position',
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
    url: (params) => `${PITCHBOOK_API_BASE}/investors/${params.pbId.trim()}/investments`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch investor investments')
    const data = await response.json()

    return {
      success: true,
      output: {
        investments: Array.isArray(data) ? data : [],
      },
    }
  },

  outputs: {
    investments: {
      type: 'array',
      description: 'Investments the investor has made, active and exited',
      items: {
        type: 'object',
        properties: {
          investorId: { type: 'string', description: 'PitchBook investor ID' },
          companyId: { type: 'string', description: 'PitchBook ID of the portfolio company' },
          companyName: { type: 'string', description: 'Name of the portfolio company' },
          investorStatus: {
            type: 'string',
            description: 'Whether the investor is a current or former holder',
            nullable: true,
          },
          investmentDate: {
            type: 'string',
            description: 'Date the position was opened (YYYY-MM-DD)',
            nullable: true,
          },
          investmentDealId: {
            type: 'string',
            description: 'PitchBook deal ID of the investment',
            nullable: true,
          },
          exitDate: {
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
