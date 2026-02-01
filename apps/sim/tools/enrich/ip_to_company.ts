import type { EnrichIpToCompanyParams, EnrichIpToCompanyResponse } from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const ipToCompanyTool: ToolConfig<EnrichIpToCompanyParams, EnrichIpToCompanyResponse> = {
  id: 'enrich_ip_to_company',
  name: 'Enrich IP to Company',
  description: 'Identify a company from an IP address with detailed firmographic information.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    ip: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'IP address to look up (e.g., 86.92.60.221)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/ip-to-company-lookup')
      url.searchParams.append('ip', params.ip.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const companyData = data.data ?? {}

    return {
      success: true,
      output: {
        name: companyData.name ?? null,
        legalName: companyData.legalName ?? null,
        domain: companyData.domain ?? null,
        domainAliases: companyData.domainAliases ?? [],
        sector: companyData.sector ?? null,
        industry: companyData.industry ?? null,
        phone: companyData.phone ?? null,
        employees: companyData.employees ?? null,
        revenue: companyData.revenue ?? null,
        location: {
          city: companyData.geo?.city ?? null,
          state: companyData.geo?.state ?? null,
          country: companyData.geo?.country ?? null,
          timezone: companyData.timezone ?? null,
        },
        linkedInUrl: companyData.linkedin?.handle
          ? `https://linkedin.com/company/${companyData.linkedin.handle}`
          : null,
        twitterUrl: companyData.twitter?.handle
          ? `https://twitter.com/${companyData.twitter.handle}`
          : null,
        facebookUrl: companyData.facebook?.handle
          ? `https://facebook.com/${companyData.facebook.handle}`
          : null,
      },
    }
  },

  outputs: {
    name: {
      type: 'string',
      description: 'Company name',
      optional: true,
    },
    legalName: {
      type: 'string',
      description: 'Legal company name',
      optional: true,
    },
    domain: {
      type: 'string',
      description: 'Primary domain',
      optional: true,
    },
    domainAliases: {
      type: 'array',
      description: 'Domain aliases',
      items: {
        type: 'string',
        description: 'Domain alias',
      },
    },
    sector: {
      type: 'string',
      description: 'Business sector',
      optional: true,
    },
    industry: {
      type: 'string',
      description: 'Industry',
      optional: true,
    },
    phone: {
      type: 'string',
      description: 'Phone number',
      optional: true,
    },
    employees: {
      type: 'number',
      description: 'Number of employees',
      optional: true,
    },
    revenue: {
      type: 'string',
      description: 'Estimated revenue',
      optional: true,
    },
    location: {
      type: 'json',
      description: 'Company location',
      properties: {
        city: { type: 'string', description: 'City' },
        state: { type: 'string', description: 'State' },
        country: { type: 'string', description: 'Country' },
        timezone: { type: 'string', description: 'Timezone' },
      },
    },
    linkedInUrl: {
      type: 'string',
      description: 'LinkedIn company URL',
      optional: true,
    },
    twitterUrl: {
      type: 'string',
      description: 'Twitter URL',
      optional: true,
    },
    facebookUrl: {
      type: 'string',
      description: 'Facebook URL',
      optional: true,
    },
  },
}
