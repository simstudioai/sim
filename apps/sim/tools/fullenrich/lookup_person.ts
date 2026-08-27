import { fullEnrichExactHosting } from '@/tools/fullenrich/hosting'
import {
  fullEnrichLookupPeopleResponseSchema,
  fullEnrichLookupPersonSchema,
} from '@/tools/fullenrich/schemas'
import {
  FULLENRICH_PERSON_OUTPUT,
  type FullEnrichLookupPeopleResponse,
  type FullEnrichLookupPersonParams,
} from '@/tools/fullenrich/types'
import { extractFullEnrichError, requireFullEnrichCredits } from '@/tools/fullenrich/utils'
import type { ToolConfig } from '@/tools/types'

export const lookupPersonTool: ToolConfig<
  FullEnrichLookupPersonParams,
  FullEnrichLookupPeopleResponse
> = {
  id: 'fullenrich_lookup_person',
  name: 'FullEnrich Lookup Person',
  description:
    'Look up one person by name, professional-network URL or ID, optionally disambiguated by company.',
  version: '1.0.0',
  hosting: fullEnrichExactHosting((_params, output) =>
    requireFullEnrichCredits(output.credits, 'FullEnrich response credits')
  ),
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'FullEnrich API key',
    },
    personName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full name of the person',
    },
    personProfessionalNetworkUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Professional-network profile URL of the person',
    },
    personProfessionalNetworkId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Professional-network profile ID of the person',
    },
    companyProfessionalNetworkUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Professional-network URL of the company used to disambiguate a name',
    },
    companyProfessionalNetworkId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Professional-network ID of the company used to disambiguate a name',
    },
    companyDomain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company domain used to disambiguate a name',
    },
  },
  request: {
    url: 'https://app.fullenrich.com/api/v2/people/lookup',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) =>
      fullEnrichLookupPersonSchema.parse({
        person_name: params.personName,
        person_professional_network_url: params.personProfessionalNetworkUrl,
        person_professional_network_id: params.personProfessionalNetworkId,
        company_professional_network_url: params.companyProfessionalNetworkUrl,
        company_professional_network_id: params.companyProfessionalNetworkId,
        company_domain: params.companyDomain,
      }),
  },
  transformResponse: async (response) => {
    if (!response.ok) throw new Error(await extractFullEnrichError(response))
    const data = fullEnrichLookupPeopleResponseSchema.parse(await response.json())
    return {
      success: true,
      output: { people: data.people, credits: data.metadata.credits },
    }
  },
  outputs: {
    people: FULLENRICH_PERSON_OUTPUT,
    credits: { type: 'number', description: 'Credits reported by FullEnrich for this lookup' },
  },
}
