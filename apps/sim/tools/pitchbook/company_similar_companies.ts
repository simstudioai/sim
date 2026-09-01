import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCompanySimilarCompaniesTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_company_similar_companies',
  name: 'PitchBook Similar Companies',
  description:
    'Retrieve companies PitchBook scores as similar to a given company, flagging which are direct competitors',
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
    url: (params) => `${PITCHBOOK_API_BASE}/companies/${params.pbId.trim()}/similar-companies`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch similar companies')
    const data = await response.json()

    return {
      success: true,
      output: {
        similarCompanies: Array.isArray(data) ? data : [],
      },
    }
  },

  outputs: {
    similarCompanies: {
      type: 'array',
      description: 'Similar companies, most similar first',
      items: {
        type: 'object',
        properties: {
          companyId: {
            type: 'string',
            description: 'PitchBook ID of the company compared against',
          },
          similarCompanyId: { type: 'string', description: 'PitchBook ID of the similar company' },
          similarCompanyName: { type: 'string', description: 'Name of the similar company' },
          similarityScore: {
            type: 'number',
            description: 'Similarity score between 0 and 1, higher is more similar',
          },
          competitor: {
            type: 'boolean',
            description: 'Whether PitchBook classifies the company as a direct competitor',
          },
        },
      },
    },
  },
}
