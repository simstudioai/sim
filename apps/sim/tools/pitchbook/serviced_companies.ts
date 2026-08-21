import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookServicedCompaniesTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> =
  {
    id: 'pitchbook_serviced_companies',
    name: 'PitchBook Serviced Companies',
    description: 'Retrieve the companies a service provider currently and formerly serves',
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
      url: (params) =>
        `${PITCHBOOK_API_BASE}/service-providers/${params.pbId.trim()}/serviced-companies`,
      method: 'GET',
      headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
    },

    transformResponse: async (response: Response) => {
      await throwIfNotOk(response, 'Failed to fetch serviced companies')
      const data = await response.json()

      return {
        success: true,
        output: {
          serviceProviderId: data.serviceProviderId ?? null,
          serviceProviderName: data.serviceProviderName ?? null,
          currentGeneralServices: data.currentGeneralServices ?? [],
          formerGeneralServices: data.formerGeneralServices ?? [],
        },
      }
    },

    outputs: {
      serviceProviderId: { type: 'string', description: 'PitchBook service provider ID' },
      serviceProviderName: { type: 'string', description: 'Service provider name' },
      currentGeneralServices: {
        type: 'array',
        description: 'Current general service relationships',
        items: {
          type: 'object',
          properties: {
            entityId: { type: 'string', description: 'PitchBook entity ID' },
            entityName: { type: 'string', description: 'Entity name' },
            serviceProvided: {
              type: 'object',
              description: 'Service provided, as a code and description pair',
              properties: {
                code: { type: 'string', description: 'PitchBook code' },
                description: { type: 'string', description: 'Human-readable label for the code' },
              },
            },
          },
        },
      },
      formerGeneralServices: {
        type: 'array',
        description: 'Former general service relationships',
        items: { type: 'json' },
      },
    },
  }
