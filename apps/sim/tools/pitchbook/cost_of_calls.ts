import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookCostOfCallsParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCostOfCallsTool: ToolConfig<PitchbookCostOfCallsParams, PitchbookResponse> = {
  id: 'pitchbook_cost_of_calls',
  name: 'PitchBook Cost of Calls',
  description:
    'Retrieve the credit cost of every API endpoint under a given pricing model, for first-time and refresh calls',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    pricingModel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pricing model to price against: SUBSCRIPTION or PAY_PER_CALL',
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
    url: (params) => {
      const qs = new URLSearchParams()
      if (params.pricingModel) qs.set('pricingModel', params.pricingModel)
      const query = qs.toString()
      return `${PITCHBOOK_API_BASE}/calls/costs${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch cost of calls')
    const data = await response.json()

    return {
      success: true,
      output: {
        costs: Array.isArray(data) ? data : [],
      },
    }
  },

  outputs: {
    costs: {
      type: 'array',
      description: 'Credit cost per endpoint',
      items: {
        type: 'object',
        properties: {
          group: { type: 'string', description: 'Endpoint group' },
          endpoint: { type: 'string', description: 'Endpoint name' },
          initialCost: { type: 'number', description: 'Credit cost of a first-time call' },
          refreshCost: {
            type: 'number',
            description: 'Credit cost of re-requesting data already pulled',
          },
        },
      },
    },
  },
}
