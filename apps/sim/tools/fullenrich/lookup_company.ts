import { fullEnrichExactHosting } from '@/tools/fullenrich/hosting'
import {
  fullEnrichLookupCompaniesResponseSchema,
  fullEnrichLookupCompanySchema,
} from '@/tools/fullenrich/schemas'
import {
  FULLENRICH_COMPANY_OUTPUT,
  type FullEnrichLookupCompaniesResponse,
  type FullEnrichLookupCompanyParams,
} from '@/tools/fullenrich/types'
import { extractFullEnrichError, requireFullEnrichCredits } from '@/tools/fullenrich/utils'
import type { ToolConfig } from '@/tools/types'

export const lookupCompanyTool: ToolConfig<
  FullEnrichLookupCompanyParams,
  FullEnrichLookupCompaniesResponse
> = {
  id: 'fullenrich_lookup_company',
  name: 'FullEnrich Lookup Company',
  description: 'Look up one company by domain or professional-network URL or ID.',
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
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company domain',
    },
    professionalNetworkUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Professional-network URL of the company',
    },
    professionalNetworkId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Professional-network ID of the company',
    },
  },
  request: {
    url: 'https://app.fullenrich.com/api/v2/company/lookup',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) =>
      fullEnrichLookupCompanySchema.parse({
        domain: params.domain,
        professional_network_url: params.professionalNetworkUrl,
        professional_network_id: params.professionalNetworkId,
      }),
  },
  transformResponse: async (response) => {
    if (!response.ok) throw new Error(await extractFullEnrichError(response))
    const data = fullEnrichLookupCompaniesResponseSchema.parse(await response.json())
    return {
      success: true,
      output: { companies: data.companies, credits: data.metadata.credits },
    }
  },
  outputs: {
    companies: FULLENRICH_COMPANY_OUTPUT,
    credits: { type: 'number', description: 'Credits reported by FullEnrich for this lookup' },
  },
}
