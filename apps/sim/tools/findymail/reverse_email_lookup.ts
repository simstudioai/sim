import { findymailHosting } from '@/tools/findymail/hosting'
import type {
  FindymailReverseEmailLookupParams,
  FindymailReverseEmailLookupResponse,
} from '@/tools/findymail/types'
import type { ToolConfig } from '@/tools/types'

export const reverseEmailLookupTool: ToolConfig<
  FindymailReverseEmailLookupParams,
  FindymailReverseEmailLookupResponse
> = {
  id: 'findymail_reverse_email_lookup',
  name: 'Findymail Reverse Email Lookup',
  description:
    'Find a business profile from an email address. Uses 1 finder credit if a profile is found, 2 credits if returning full profile data.',
  version: '1.0.0',

  hosting: findymailHosting<FindymailReverseEmailLookupParams>((params, output) => {
    const found = Boolean(output.email || output.linkedin_url || output.fullName)
    if (!found) return 0
    // 1 credit for a match, 2 when full profile enrichment is requested.
    return params.with_profile ? 2 : 1
  }),

  params: {
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Work or personal email address to look up',
    },
    with_profile: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to return enriched profile metadata (default: false)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Findymail API Key',
    },
  },

  request: {
    url: 'https://app.findymail.com/api/search/reverse-email',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => ({
      email: params.email,
      ...(params.with_profile ? { with_profile: true } : {}),
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as Record<string, string>).message ||
          (errorData as Record<string, string>).error ||
          `Findymail API error: ${response.status} ${response.statusText}`,
        output: {
          email: null,
          linkedin_url: null,
          fullName: null,
          username: null,
          headline: null,
          jobTitle: null,
          summary: null,
          city: null,
          region: null,
          country: null,
          companyLinkedinUrl: null,
          companyName: null,
          companyWebsite: null,
          isPremium: null,
          isOpenProfile: null,
          skills: [],
          jobs: [],
          educations: [],
          certificates: [],
        },
      }
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        email: data.email ?? null,
        linkedin_url: data.linkedin_url ?? null,
        fullName: data.fullName ?? null,
        username: data.username ?? null,
        headline: data.headline ?? null,
        jobTitle: data.jobTitle ?? null,
        summary: data.summary ?? null,
        city: data.city ?? null,
        region: data.region ?? null,
        country: data.country ?? null,
        companyLinkedinUrl: data.companyLinkedinUrl ?? null,
        companyName: data.companyName ?? null,
        companyWebsite: data.companyWebsite ?? null,
        isPremium: data.isPremium ?? null,
        isOpenProfile: data.isOpenProfile ?? null,
        skills: data.skills ?? [],
        jobs: data.jobs ?? [],
        educations: data.educations ?? [],
        certificates: data.certificates ?? [],
      },
    }
  },

  outputs: {
    email: { type: 'string', description: 'The email address that was looked up', optional: true },
    linkedin_url: { type: 'string', description: 'LinkedIn profile URL', optional: true },
    fullName: { type: 'string', description: 'Full name from profile', optional: true },
    username: { type: 'string', description: 'LinkedIn username', optional: true },
    headline: { type: 'string', description: 'Profile headline', optional: true },
    jobTitle: { type: 'string', description: 'Current job title', optional: true },
    summary: { type: 'string', description: 'Profile summary', optional: true },
    city: { type: 'string', description: 'City', optional: true },
    region: { type: 'string', description: 'Region or state', optional: true },
    country: { type: 'string', description: 'Country', optional: true },
    companyLinkedinUrl: {
      type: 'string',
      description: 'Current company LinkedIn URL',
      optional: true,
    },
    companyName: { type: 'string', description: 'Current company name', optional: true },
    companyWebsite: { type: 'string', description: 'Current company website', optional: true },
    isPremium: {
      type: 'boolean',
      description: 'Whether the profile has LinkedIn Premium',
      optional: true,
    },
    isOpenProfile: {
      type: 'boolean',
      description: 'Whether the profile is an Open Profile',
      optional: true,
    },
    skills: { type: 'array', description: 'List of profile skills' },
    jobs: { type: 'array', description: 'Job history entries' },
    educations: {
      type: 'array',
      description: 'Education history (school, degree, fieldOfStudy, startDate, endDate)',
    },
    certificates: {
      type: 'array',
      description: 'Certifications (name, issuingOrganization, issueDate, expirationDate)',
    },
  },
}
