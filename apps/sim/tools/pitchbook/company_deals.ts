import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCompanyDealsTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_company_deals',
  name: 'PitchBook Company Deals',
  description:
    'Retrieve every deal a company has been involved in, in chronological order with its deal type',
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
    url: (params) => `${PITCHBOOK_API_BASE}/companies/${params.pbId.trim()}/deals`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch company deals')
    const data = await response.json()

    return {
      success: true,
      output: {
        deals: Array.isArray(data) ? data : [],
      },
    }
  },

  outputs: {
    deals: {
      type: 'array',
      description: 'Deals involving the company, oldest first',
      items: {
        type: 'object',
        properties: {
          companyId: { type: 'string', description: 'PitchBook company ID' },
          dealId: { type: 'string', description: 'PitchBook deal ID' },
          dealDate: {
            type: 'string',
            description: 'Date of the deal (YYYY-MM-DD)',
            nullable: true,
          },
          dealType1: {
            type: 'object',
            description: 'Primary deal type',
            nullable: true,
            properties: {
              code: { type: 'string', description: 'Deal type code', nullable: true },
              description: { type: 'string', description: 'Deal type label', nullable: true },
            },
          },
          dealType2: {
            type: 'object',
            description: 'Secondary deal type, such as the round letter',
            nullable: true,
            properties: {
              code: { type: 'string', description: 'Deal type code', nullable: true },
              description: { type: 'string', description: 'Deal type label', nullable: true },
            },
          },
          dealType3: {
            type: 'object',
            description: 'Tertiary deal type',
            nullable: true,
            properties: {
              code: { type: 'string', description: 'Deal type code', nullable: true },
              description: { type: 'string', description: 'Deal type label', nullable: true },
            },
          },
          dealNumber: {
            type: 'number',
            description: 'Sequence of this deal in the company financing history',
          },
        },
      },
    },
  },
}
