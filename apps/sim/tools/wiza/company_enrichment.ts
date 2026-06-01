import type { ToolConfig } from '@/tools/types'
import { wizaHosting } from '@/tools/wiza/hosting'
import type { WizaCompanyEnrichmentParams, WizaCompanyEnrichmentResponse } from '@/tools/wiza/types'

export const wizaCompanyEnrichmentTool: ToolConfig<
  WizaCompanyEnrichmentParams,
  WizaCompanyEnrichmentResponse
> = {
  id: 'wiza_company_enrichment',
  name: 'Wiza Company Enrichment',
  description:
    'Enrich a company by name, domain, LinkedIn ID, or LinkedIn slug with detailed firmographic data',
  version: '1.0.0',

  hosting: wizaHosting<WizaCompanyEnrichmentParams>((_params, output) => {
    // 2 API credits per successful company match; no charge on a no-match.
    return output.company_name || output.company_domain || output.domain ? 2 : 0
  }),

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Wiza API key',
    },
    company_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name (e.g., "Wiza")',
    },
    company_domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company domain (e.g., "wiza.co")',
    },
    company_linkedin_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company LinkedIn ID',
    },
    company_linkedin_slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company LinkedIn slug from the URL',
    },
  },

  request: {
    url: 'https://wiza.co/api/company_enrichments',
    method: 'POST',
    headers: (params: WizaCompanyEnrichmentParams) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: WizaCompanyEnrichmentParams) => {
      const body: Record<string, unknown> = {}
      if (params.company_name) body.company_name = params.company_name
      if (params.company_domain) body.company_domain = params.company_domain
      if (params.company_linkedin_id) body.company_linkedin_id = params.company_linkedin_id
      if (params.company_linkedin_slug) body.company_linkedin_slug = params.company_linkedin_slug
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Wiza API error: ${response.status} - ${errorText}`)
    }

    const json = await response.json()
    const d = json.data ?? {}

    return {
      success: true,
      output: {
        company_name: d.company_name ?? null,
        company_domain: d.company_domain ?? null,
        domain: d.domain ?? null,
        company_industry: d.company_industry ?? null,
        company_size: d.company_size ?? null,
        company_size_range: d.company_size_range ?? null,
        company_founded: d.company_founded ?? null,
        company_revenue_range: d.company_revenue_range ?? null,
        company_funding: d.company_funding ?? null,
        company_type: d.company_type ?? null,
        company_description: d.company_description ?? null,
        company_ticker: d.company_ticker ?? null,
        company_last_funding_round: d.company_last_funding_round ?? null,
        company_last_funding_amount: d.company_last_funding_amount ?? null,
        company_last_funding_at: d.company_last_funding_at ?? null,
        company_location: d.company_location ?? null,
        company_twitter: d.company_twitter ?? null,
        company_facebook: d.company_facebook ?? null,
        company_linkedin: d.company_linkedin ?? null,
        company_linkedin_id: d.company_linkedin_id ?? null,
        company_street: d.company_street ?? null,
        company_locality: d.company_locality ?? null,
        company_region: d.company_region ?? null,
        company_postal_code: d.company_postal_code ?? null,
        company_country: d.company_country ?? null,
        credits: d.credits ?? null,
      },
    }
  },

  outputs: {
    company_name: { type: 'string', description: 'Company name', optional: true },
    company_domain: { type: 'string', description: 'Company domain', optional: true },
    domain: { type: 'string', description: 'Domain', optional: true },
    company_industry: { type: 'string', description: 'Industry', optional: true },
    company_size: { type: 'number', description: 'Employee count', optional: true },
    company_size_range: { type: 'string', description: 'Headcount range', optional: true },
    company_founded: { type: 'number', description: 'Year founded', optional: true },
    company_revenue_range: { type: 'string', description: 'Revenue range', optional: true },
    company_funding: { type: 'string', description: 'Total funding', optional: true },
    company_type: { type: 'string', description: 'Company type', optional: true },
    company_description: { type: 'string', description: 'Description', optional: true },
    company_ticker: { type: 'string', description: 'Stock ticker', optional: true },
    company_last_funding_round: {
      type: 'string',
      description: 'Last funding round',
      optional: true,
    },
    company_last_funding_amount: {
      type: 'string',
      description: 'Last funding amount',
      optional: true,
    },
    company_last_funding_at: { type: 'string', description: 'Last funding date', optional: true },
    company_location: { type: 'string', description: 'Full location string', optional: true },
    company_twitter: { type: 'string', description: 'Twitter URL', optional: true },
    company_facebook: { type: 'string', description: 'Facebook URL', optional: true },
    company_linkedin: { type: 'string', description: 'LinkedIn URL', optional: true },
    company_linkedin_id: { type: 'string', description: 'LinkedIn ID', optional: true },
    company_street: { type: 'string', description: 'Street address', optional: true },
    company_locality: { type: 'string', description: 'City', optional: true },
    company_region: { type: 'string', description: 'State/region', optional: true },
    company_postal_code: { type: 'string', description: 'Postal code', optional: true },
    company_country: { type: 'string', description: 'Country', optional: true },
    credits: {
      type: 'json',
      description: 'Credits deducted for this enrichment (api_credits: { total, company_credits })',
      optional: true,
    },
  },
}
