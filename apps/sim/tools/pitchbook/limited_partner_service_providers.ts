import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookLimitedPartnerServiceProvidersTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_limited_partner_service_providers',
  name: 'PitchBook Limited Partner Service Providers',
  description: 'Retrieve the current and former service providers engaged by a limited partner',
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
      description: 'PitchBook limited partner ID, e.g. 58901-50.',
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
      `${PITCHBOOK_API_BASE}/limited-partners/${params.pbId.trim()}/service-providers`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch limited partner service providers')
    const data = await response.json()

    return {
      success: true,
      output: {
        limitedPartnerId: data.limitedPartnerId ?? null,
        currentGeneralServices: data.currentGeneralServices ?? [],
        formerGeneralServices: data.formerGeneralServices ?? [],
      },
    }
  },

  outputs: {
    limitedPartnerId: {
      type: 'string',
      description: 'PitchBook limited partner ID',
      nullable: true,
    },
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
