import type { HunterEnrichmentParams, HunterEnrichmentResponse } from '@/tools/hunter/types'
import type { ToolConfig } from '@/tools/types'

export const companiesFindTool: ToolConfig<HunterEnrichmentParams, HunterEnrichmentResponse> = {
  id: 'hunter_companies_find',
  name: 'Hunter Companies Find',
  description: 'Enriches company data using domain name.',
  version: '1.0.0',

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Domain to find company data for (e.g., "stripe.com", "company.io")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hunter.io API Key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.hunter.io/v2/companies/find')
      url.searchParams.append('api_key', params.apiKey)
      url.searchParams.append('domain', params.domain || '')

      return url.toString()
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const c = data.data ?? {}

    return {
      success: true,
      output: {
        name: c.name ?? '',
        domain: c.domain ?? '',
        description: c.description ?? '',
        industry: c.category?.industry ?? '',
        sector: c.category?.sector ?? '',
        size:
          c.metrics?.employeesRange ??
          (c.metrics?.employees != null ? String(c.metrics.employees) : ''),
        founded_year: c.foundedYear ?? null,
        location: c.location ?? '',
        country: c.geo?.country ?? '',
        country_code: c.geo?.countryCode ?? '',
        state: c.geo?.state ?? '',
        city: c.geo?.city ?? '',
        linkedin: c.linkedin?.handle ?? '',
        twitter: c.twitter?.handle ?? '',
        facebook: c.facebook?.handle ?? '',
        logo: c.logo ?? '',
        phone: c.phone ?? '',
        tech: c.tech ?? [],
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'Company name' },
    domain: { type: 'string', description: 'Company domain' },
    description: { type: 'string', description: 'Company description' },
    industry: { type: 'string', description: 'Industry classification' },
    sector: { type: 'string', description: 'Business sector' },
    size: { type: 'string', description: 'Employee headcount range (e.g., "11-50")' },
    founded_year: { type: 'number', description: 'Year founded', optional: true },
    location: { type: 'string', description: 'Headquarters location (formatted)' },
    country: { type: 'string', description: 'Country (full name)' },
    country_code: { type: 'string', description: 'ISO 3166-1 alpha-2 country code' },
    state: { type: 'string', description: 'State/province' },
    city: { type: 'string', description: 'City' },
    linkedin: { type: 'string', description: 'LinkedIn handle (e.g., company/hunterio)' },
    twitter: { type: 'string', description: 'Twitter handle' },
    facebook: { type: 'string', description: 'Facebook handle' },
    logo: { type: 'string', description: 'Company logo URL' },
    phone: { type: 'string', description: 'Company phone number' },
    tech: {
      type: 'array',
      description: 'Technologies used by the company',
      items: { type: 'string', description: 'Technology name' },
    },
  },
}
