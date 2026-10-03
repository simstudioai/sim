import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookServiceProviderBioTool: ToolConfig<
  PitchbookProfileParams,
  PitchbookResponse
> = {
  id: 'pitchbook_service_provider_bio',
  name: 'PitchBook Service Provider Bio',
  description:
    'Retrieve the profile of a service provider: names, types, description, and how many companies, deals, investors, funds, and limited partners it has serviced',
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
        'PitchBook service provider ID, e.g. 11356-75. Use a service provider search to resolve a name to an ID.',
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
    url: (params) => `${PITCHBOOK_API_BASE}/service-providers/${params.pbId.trim()}/bio`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch service provider bio')
    const data = await response.json()

    return {
      success: true,
      output: {
        serviceProviderId: data.serviceProviderId ?? null,
        serviceProviderName: data.serviceProviderName ?? null,
        description: data.description ?? null,
        website: data.website ?? null,
        employees: data.employees ?? null,
        servicedCompanies: data.servicedCompanies ?? null,
        servicedDeals: data.servicedDeals ?? null,
        servicedInvestors: data.servicedInvestors ?? null,
        servicedFunds: data.servicedFunds ?? null,
        servicedLimitedPartners: data.servicedLimitedPartners ?? null,
        serviceProviderTypes: data.serviceProviderTypes ?? [],
      },
    }
  },

  outputs: {
    serviceProviderId: {
      type: 'string',
      description: 'PitchBook service provider ID',
      nullable: true,
    },
    serviceProviderName: {
      type: 'object',
      description: 'The names the service provider is known by',
      properties: {
        formalName: { type: 'string', description: 'Formal name', nullable: true },
        alsoKnownAs: { type: 'string', description: 'Also-known-as name', nullable: true },
        legalName: { type: 'string', description: 'Registered legal name', nullable: true },
        formerlyKnownAs: { type: 'string', description: 'Previous name', nullable: true },
      },
    },
    serviceProviderTypes: {
      type: 'array',
      description: 'Types the service provider is classified as, one flagged primary',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'object',
            description: 'Service provider type',
            properties: {
              code: { type: 'string', description: 'Type code' },
              description: { type: 'string', description: 'Type label' },
            },
          },
          primary: { type: 'boolean', description: 'Whether this is the primary type' },
        },
      },
    },
    description: {
      type: 'string',
      description: 'Description of the service provider',
      nullable: true,
    },
    website: { type: 'string', description: 'Service provider website', nullable: true },
    employees: { type: 'number', description: 'Employee count', nullable: true },
    servicedCompanies: {
      type: 'number',
      description: 'Number of companies serviced',
      nullable: true,
    },
    servicedDeals: { type: 'number', description: 'Number of deals serviced', nullable: true },
    servicedInvestors: {
      type: 'number',
      description: 'Number of investors serviced',
      nullable: true,
    },
    servicedFunds: { type: 'number', description: 'Number of funds serviced', nullable: true },
    servicedLimitedPartners: {
      type: 'number',
      description: 'Number of limited partners serviced',
      nullable: true,
    },
  },
}
