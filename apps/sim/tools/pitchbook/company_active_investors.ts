import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCompanyActiveInvestorsTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_company_active_investors',
  name: 'PitchBook Company Active Investors',
  description: 'Retrieve only the investors currently holding a position in a company',
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
        'PitchBook company ID, e.g. 10618-03. Use PitchBook Search to resolve a name to an ID.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/companies/${params.pbId.trim()}/active-investors`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch company active investors')
    const data = await response.json()

    return {
      success: true,
      output: {
        activeInvestors: Array.isArray(data) ? data : [],
      },
    }
  },

  outputs: {
    activeInvestors: {
      type: 'array',
      description: 'Investors currently holding a position in the company',
      items: {
        type: 'object',
        properties: {
          companyId: { type: 'string', description: 'PitchBook company ID' },
          investorId: { type: 'string', description: 'PitchBook investor ID' },
          investorName: { type: 'string', description: 'Investor name' },
          investorTypes: {
            type: 'array',
            description: 'Types the investor is classified as, one flagged primary',
            items: {
              type: 'object',
              properties: {
                primary: { type: 'boolean', description: 'Whether this is the primary entry' },
                type: {
                  type: 'object',
                  description: 'Type as a code and description pair',
                  properties: {
                    description: {
                      type: 'string',
                      description: 'Human-readable label for the code',
                    },
                    code: { type: 'string', description: 'PitchBook code' },
                  },
                },
              },
            },
          },
          investorSince: {
            type: 'string',
            description: 'Date the investor first invested (YYYY-MM-DD)',
          },
          holding: { type: 'string', description: 'Current holding status' },
        },
      },
    },
  },
}
