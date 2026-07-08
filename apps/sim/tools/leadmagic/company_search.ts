import { leadmagicHosting } from '@/tools/leadmagic/hosting'
import type {
  LeadMagicCompanySearchParams,
  LeadMagicCompanySearchResponse,
} from '@/tools/leadmagic/types'
import type { ToolConfig } from '@/tools/types'

export const companySearchTool: ToolConfig<
  LeadMagicCompanySearchParams,
  LeadMagicCompanySearchResponse
> = {
  id: 'leadmagic_company_search',
  name: 'LeadMagic Company Search',
  description:
    'Enrich company data including firmographics, headcount, funding, and social profiles by domain, LinkedIn URL, or name. Charges 1 credit when a company is found; free when no result.',
  version: '1.0.0',

  hosting: leadmagicHosting<LeadMagicCompanySearchParams>((_params, output) => {
    // 1 credit when company found, 0 otherwise.
    // Source: https://leadmagic.io/docs/v1/reference/company-search
    const consumed = output.credits_consumed
    return typeof consumed === 'number' ? consumed : output.companyName ? 1 : 0
  }),

  params: {
    company_domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company website domain (e.g., stripe.com). Provide at least one identifier.',
    },
    profile_url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'LinkedIn company profile URL (e.g., https://linkedin.com/company/stripe). Provide at least one identifier.',
    },
    company_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Company name (fallback if domain/URL unavailable). Provide at least one identifier.',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LeadMagic API Key',
    },
  },

  request: {
    url: 'https://api.leadmagic.io/v1/companies/company-search',
    method: 'POST',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, string> = {}
      if (params.company_domain) body.company_domain = params.company_domain
      if (params.profile_url) body.profile_url = params.profile_url
      if (params.company_name) body.company_name = params.company_name
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        (errorData as Record<string, string>).message ||
          `LeadMagic API error: ${response.status} ${response.statusText}`
      )
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        companyName: data.companyName ?? null,
        companyId: data.companyId ?? null,
        industry: data.industry ?? null,
        employeeCount: data.employeeCount ?? null,
        employeeRange: data.employeeRange ?? null,
        founded: data.founded ?? null,
        headquarters: data.headquarters ?? null,
        revenue: data.revenue ?? null,
        funding: data.funding ?? null,
        description: data.description ?? null,
        specialties: data.specialties ?? [],
        competitors: data.competitors ?? [],
        followerCount: data.followerCount ?? null,
        twitter_url: data.twitter_url ?? null,
        facebook_url: data.facebook_url ?? null,
        b2b_profile_url: data.b2b_profile_url ?? null,
        logo_url: data.logo_url ?? null,
        credits_consumed: data.credits_consumed ?? 0,
        message: data.message ?? null,
      },
    }
  },

  outputs: {
    companyName: { type: 'string', description: 'Company name', optional: true },
    companyId: { type: 'number', description: 'Internal company identifier', optional: true },
    industry: { type: 'string', description: 'Industry classification', optional: true },
    employeeCount: { type: 'number', description: 'Number of employees', optional: true },
    employeeRange: {
      type: 'string',
      description: 'Headcount range (e.g., 1001-5000)',
      optional: true,
    },
    founded: { type: 'number', description: 'Year the company was founded', optional: true },
    headquarters: { type: 'json', description: 'Headquarters location object', optional: true },
    revenue: { type: 'string', description: 'Revenue range', optional: true },
    funding: { type: 'string', description: 'Total funding amount', optional: true },
    description: { type: 'string', description: 'Company description', optional: true },
    specialties: { type: 'array', description: 'Company specialties and focus areas' },
    competitors: { type: 'array', description: 'Competitor companies' },
    followerCount: { type: 'number', description: 'LinkedIn follower count', optional: true },
    twitter_url: { type: 'string', description: 'Twitter/X profile URL', optional: true },
    facebook_url: { type: 'string', description: 'Facebook page URL', optional: true },
    b2b_profile_url: {
      type: 'string',
      description: 'LinkedIn company profile URL',
      optional: true,
    },
    logo_url: { type: 'string', description: 'Company logo URL', optional: true },
    credits_consumed: { type: 'number', description: 'Credits charged (1 when company found)' },
    message: { type: 'string', description: 'Human-readable status message', optional: true },
  },
}
