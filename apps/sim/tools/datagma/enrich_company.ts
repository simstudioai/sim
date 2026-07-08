import { datagmaHosting } from '@/tools/datagma/hosting'
import type {
  DatagmaEnrichCompanyParams,
  DatagmaEnrichCompanyResponse,
} from '@/tools/datagma/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Enrich a company profile from a company domain, name, or SIREN number.
 *
 * Endpoint: GET https://gateway.datagma.net/api/ingress/v2/full
 * Auth: apiId query param
 * Docs: https://datagmaapi.readme.io/reference/ingressservice_fullapiv2
 * Pricing: 2 credits per successful response
 */
export const enrichCompanyTool: ToolConfig<
  DatagmaEnrichCompanyParams,
  DatagmaEnrichCompanyResponse
> = {
  id: 'datagma_enrich_company',
  name: 'Datagma Enrich Company',
  description:
    'Enrich a company profile using a domain, company name, or SIREN number (France). Returns size, industry, revenue, and description. Uses 2 credits per match.',
  version: '1.0.0',

  hosting: datagmaHosting<DatagmaEnrichCompanyParams>((_params, output) => {
    const name = output.name as string | null
    const website = output.website as string | null
    return name || website ? 2 : 0
  }),

  params: {
    data: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "Company domain (e.g., 'stripe.com'), company name, or French SIREN number to enrich",
    },
    companyPremium: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include LinkedIn company data in the response',
    },
    companyFull: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include financial information in the response',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datagma API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://gateway.datagma.net/api/ingress/v2/full')
      url.searchParams.set('apiId', params.apiKey)
      url.searchParams.set('data', params.data)
      if (params.companyPremium != null)
        url.searchParams.set('companyPremium', String(params.companyPremium))
      if (params.companyFull != null)
        url.searchParams.set('companyFull', String(params.companyFull))
      return url.toString()
    },
    method: 'GET',
    headers: () => ({ Accept: 'application/json' }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as Record<string, string>).message ||
          `Datagma API error: ${response.status} ${response.statusText}`,
        output: {
          name: null,
          website: null,
          industries: null,
          companySize: null,
          type: null,
          founded: null,
          shortDescription: null,
          revenueRange: null,
          headquarters: null,
        },
      }
    }
    const data = (await response.json()) as Record<string, unknown>

    // Company data may be nested under a `company` key or returned at the top level
    const company = (data.company ?? data) as Record<string, unknown>

    return {
      success: true,
      output: {
        name: (company.name as string | null) ?? null,
        website: (company.website as string | null) ?? null,
        industries: (company.industries as string | null) ?? null,
        companySize: (company.companySize as string | null) ?? null,
        type: (company.type as string | null) ?? null,
        founded: (company.founded as string | null) ?? null,
        shortDescription: (company.shortDescription as string | null) ?? null,
        revenueRange: (company.revenueRange as string | null) ?? null,
        headquarters: (company.headquarters as string | null) ?? null,
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'Company name', optional: true },
    website: { type: 'string', description: 'Company website', optional: true },
    industries: { type: 'string', description: 'Industry classification', optional: true },
    companySize: { type: 'string', description: 'Employee headcount range', optional: true },
    type: { type: 'string', description: 'Company type (e.g., Private, Public)', optional: true },
    founded: { type: 'string', description: 'Year founded', optional: true },
    shortDescription: { type: 'string', description: 'Short company description', optional: true },
    revenueRange: {
      type: 'string',
      description: 'Estimated annual revenue range',
      optional: true,
    },
    headquarters: { type: 'string', description: 'Headquarters location', optional: true },
  },
}
