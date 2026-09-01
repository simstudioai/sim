import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookServicedDealsTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_serviced_deals',
  name: 'PitchBook Serviced Deals',
  description: 'Retrieve the deals a service provider worked on and what it was hired for on each',
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
      description: 'PitchBook service provider ID, e.g. 11356-75.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/service-providers/${params.pbId.trim()}/serviced-deals`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch serviced deals')
    const data = await response.json()

    return {
      success: true,
      output: {
        serviceProviderName: data.serviceProviderName ?? null,
        servicedDealInfo: data.servicedDealInfo ?? [],
      },
    }
  },

  outputs: {
    serviceProviderName: { type: 'string', description: 'Service provider name', nullable: true },
    servicedDealInfo: {
      type: 'array',
      description: 'Deals the service provider worked on',
      items: {
        type: 'object',
        properties: {
          companyId: { type: 'string', description: 'PitchBook company ID' },
          companyName: { type: 'string', description: 'Company name' },
          serviceProvided: {
            type: 'object',
            description: 'Service provided, as a code and description pair',
            properties: {
              code: { type: 'string', description: 'PitchBook code' },
              description: { type: 'string', description: 'Human-readable label for the code' },
            },
          },
          dealId: { type: 'string', description: 'PitchBook deal ID' },
          dealNumber: {
            type: 'number',
            description: 'Sequence of the deal in the company financing history',
          },
          dealDate: { type: 'string', description: 'Date the deal closed (YYYY-MM-DD)' },
        },
      },
    },
  },
}
