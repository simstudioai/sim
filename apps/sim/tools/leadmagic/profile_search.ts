import { leadmagicHosting } from '@/tools/leadmagic/hosting'
import type {
  LeadMagicProfileSearchParams,
  LeadMagicProfileSearchResponse,
} from '@/tools/leadmagic/types'
import type { ToolConfig } from '@/tools/types'

export const profileSearchTool: ToolConfig<
  LeadMagicProfileSearchParams,
  LeadMagicProfileSearchResponse
> = {
  id: 'leadmagic_profile_search',
  name: 'LeadMagic Profile Search',
  description:
    'Enrich a LinkedIn profile with work history, education, skills, and contact data. Charges 1 credit per successful enrichment; free when profile not found.',
  version: '1.0.0',

  hosting: leadmagicHosting<LeadMagicProfileSearchParams>((_params, output) => {
    // 1 credit per successful enrichment, 0 when not found.
    // Source: https://leadmagic.io/docs/v1/reference/profile-search
    const consumed = output.credits_consumed
    return typeof consumed === 'number' ? consumed : output.full_name ? 1 : 0
  }),

  params: {
    profile_url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL or username (e.g., https://linkedin.com/in/johndoe)',
    },
    extended_response: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include additional profile image URL in the response (default: false)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LeadMagic API Key',
    },
  },

  request: {
    url: 'https://api.leadmagic.io/v1/people/profile-search',
    method: 'POST',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = { profile_url: params.profile_url }
      if (params.extended_response !== undefined) body.extended_response = params.extended_response
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
        profile_url: data.profile_url ?? null,
        first_name: data.first_name ?? null,
        last_name: data.last_name ?? null,
        full_name: data.full_name ?? null,
        professional_title: data.professional_title ?? null,
        bio: data.bio ?? null,
        location: data.location ?? null,
        country: data.country ?? null,
        followers_range: data.followers_range ?? null,
        company_name: data.company_name ?? null,
        company_industry: data.company_industry ?? null,
        company_website: data.company_website ?? null,
        total_tenure_years: data.total_tenure_years ?? null,
        total_tenure_months: data.total_tenure_months ?? null,
        work_experience: data.work_experience ?? [],
        education: data.education ?? [],
        certifications: data.certifications ?? [],
        credits_consumed: data.credits_consumed ?? 0,
        message: data.message ?? null,
      },
    }
  },

  outputs: {
    profile_url: { type: 'string', description: 'LinkedIn profile URL', optional: true },
    first_name: { type: 'string', description: 'First name', optional: true },
    last_name: { type: 'string', description: 'Last name', optional: true },
    full_name: { type: 'string', description: 'Full name', optional: true },
    professional_title: { type: 'string', description: 'Current job title', optional: true },
    bio: { type: 'string', description: 'Profile bio / summary', optional: true },
    location: { type: 'string', description: 'Location string', optional: true },
    country: { type: 'string', description: 'Country', optional: true },
    followers_range: { type: 'string', description: 'LinkedIn follower range', optional: true },
    company_name: { type: 'string', description: 'Current employer', optional: true },
    company_industry: {
      type: 'string',
      description: 'Industry of current employer',
      optional: true,
    },
    company_website: { type: 'string', description: 'Company website', optional: true },
    total_tenure_years: {
      type: 'string',
      description: 'Total professional tenure in years',
      optional: true,
    },
    total_tenure_months: {
      type: 'string',
      description: 'Total professional tenure in months',
      optional: true,
    },
    work_experience: { type: 'array', description: 'Work history entries' },
    education: { type: 'array', description: 'Education history entries' },
    certifications: { type: 'array', description: 'Professional certifications' },
    credits_consumed: { type: 'number', description: 'Credits charged (1 when profile found)' },
    message: { type: 'string', description: 'Human-readable status message', optional: true },
  },
}
