import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookServicedFundsTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_serviced_funds',
  name: 'PitchBook Serviced Funds',
  description:
    'Retrieve the funds a service provider has worked with and the service provided to each',
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
    url: (params) => `${PITCHBOOK_API_BASE}/service-providers/${params.pbId.trim()}/serviced-funds`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch serviced funds')
    const data = await response.json()

    return {
      success: true,
      output: {
        serviceProviderId: data.serviceProviderId ?? null,
        serviceProviderName: data.serviceProviderName ?? null,
        fundServices: data.fundServices ?? [],
      },
    }
  },

  outputs: {
    serviceProviderId: {
      type: 'string',
      description: 'PitchBook service provider ID',
      nullable: true,
    },
    serviceProviderName: { type: 'string', description: 'Service provider name', nullable: true },
    fundServices: {
      type: 'array',
      description: 'Funds the service provider worked with',
      items: {
        type: 'object',
        properties: {
          fundId: { type: 'string', description: 'PitchBook fund ID' },
          fundName: { type: 'string', description: 'Fund name' },
          serviceProvided: {
            type: 'object',
            description: 'Service provided, as a code and description pair',
            properties: {
              description: { type: 'string', description: 'Human-readable label for the code' },
              code: { type: 'string', description: 'PitchBook code' },
            },
          },
          servicedEntityType: {
            type: 'object',
            description: 'Type of entity that was serviced',
            properties: {
              description: { type: 'string', description: 'Human-readable label for the code' },
              code: { type: 'string', description: 'PitchBook code' },
            },
          },
        },
      },
    },
  },
}
