import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookCompanyGeneralServiceProvidersTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_company_general_service_providers',
  name: 'PitchBook Company General Service Providers',
  description: 'Retrieve the current and former general service providers engaged by a company',
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
    url: (params) =>
      `${PITCHBOOK_API_BASE}/companies/${params.pbId.trim()}/general-service-providers`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch company general service providers')
    const data = await response.json()

    return {
      success: true,
      output: {
        companyId: data.companyId ?? null,
        currentGeneralServices: data.currentGeneralServices ?? [],
        formerGeneralServices: data.formerGeneralServices ?? [],
      },
    }
  },

  outputs: {
    companyId: { type: 'string', description: 'PitchBook company ID', nullable: true },
    currentGeneralServices: {
      type: 'array',
      description: 'Current general service relationships',
      items: {
        type: 'object',
        properties: {
          serviceProviderId: { type: 'string', description: 'PitchBook service provider ID' },
          serviceProviderName: { type: 'string', description: 'Service provider name' },
          serviceProviderTypes: {
            type: 'array',
            description: 'Types the service provider is classified as',
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
          serviceProvided: {
            type: 'object',
            description: 'Service provided, as a code and description pair',
            properties: {
              description: { type: 'string', description: 'Human-readable label for the code' },
              code: { type: 'string', description: 'PitchBook code' },
            },
          },
        },
      },
    },
    formerGeneralServices: {
      type: 'array',
      description: 'Former general service relationships',
      items: {
        type: 'object',
        properties: {
          serviceProviderId: { type: 'string', description: 'PitchBook service provider ID' },
          serviceProviderName: { type: 'string', description: 'Service provider name' },
          serviceProviderTypes: {
            type: 'array',
            description: 'Types the service provider is classified as',
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
          serviceProvided: {
            type: 'object',
            description: 'Service provided, as a code and description pair',
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
