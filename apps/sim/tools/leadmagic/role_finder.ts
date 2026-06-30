import { leadmagicHosting } from '@/tools/leadmagic/hosting'
import type {
  LeadMagicRoleFinderParams,
  LeadMagicRoleFinderResponse,
} from '@/tools/leadmagic/types'
import type { ToolConfig } from '@/tools/types'

export const roleFinderTool: ToolConfig<LeadMagicRoleFinderParams, LeadMagicRoleFinderResponse> = {
  id: 'leadmagic_role_finder',
  name: 'LeadMagic Role Finder',
  description:
    'Find the person holding a specific job role at a company. Charges 2 credits when a matching person is found; free when no result.',
  version: '1.0.0',

  hosting: leadmagicHosting<LeadMagicRoleFinderParams>((_params, output) => {
    // 2 credits when a person is found, 0 otherwise.
    // Source: https://leadmagic.io/docs/v1/reference/role-finder
    const consumed = output.credits_consumed
    return typeof consumed === 'number' ? consumed : output.full_name ? 2 : 0
  }),

  params: {
    job_title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Job role to search for (e.g., Head of Sales, CTO). Supports partial matching.',
    },
    company_domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company website domain (e.g., stripe.com). Provide domain or company_name.',
    },
    company_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name (fallback if domain unavailable). Provide domain or company_name.',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LeadMagic API Key',
    },
  },

  request: {
    url: 'https://api.leadmagic.io/v1/people/role-finder',
    method: 'POST',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, string> = { job_title: params.job_title }
      if (params.company_domain) body.company_domain = params.company_domain
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
        first_name: data.first_name ?? null,
        last_name: data.last_name ?? null,
        full_name: data.full_name ?? null,
        profile_url: data.profile_url ?? null,
        job_title: data.job_title ?? null,
        company_name: data.company_name ?? null,
        company_website: data.company_website ?? null,
        credits_consumed: data.credits_consumed ?? 0,
        message: data.message ?? null,
      },
    }
  },

  outputs: {
    first_name: { type: 'string', description: 'First name of the person found', optional: true },
    last_name: { type: 'string', description: 'Last name of the person found', optional: true },
    full_name: { type: 'string', description: 'Full name of the person found', optional: true },
    profile_url: { type: 'string', description: 'LinkedIn profile URL', optional: true },
    job_title: { type: 'string', description: 'Verified job title at the company', optional: true },
    company_name: { type: 'string', description: 'Company name', optional: true },
    company_website: { type: 'string', description: 'Company website', optional: true },
    credits_consumed: { type: 'number', description: 'Credits charged (2 when person found)' },
    message: { type: 'string', description: 'Human-readable status message', optional: true },
  },
}
