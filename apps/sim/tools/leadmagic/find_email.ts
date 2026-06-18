import { leadmagicHosting } from '@/tools/leadmagic/hosting'
import type { LeadMagicFindEmailParams, LeadMagicFindEmailResponse } from '@/tools/leadmagic/types'
import type { ToolConfig } from '@/tools/types'

export const findEmailTool: ToolConfig<LeadMagicFindEmailParams, LeadMagicFindEmailResponse> = {
  id: 'leadmagic_find_email',
  name: 'LeadMagic Find Email',
  description:
    "Find someone's verified work email from their name and company domain. Charges 1 credit when a valid email is found; free when no result.",
  version: '1.0.0',

  hosting: leadmagicHosting<LeadMagicFindEmailParams>((_params, output) => {
    // 1 credit per valid email found, 0 credits when not found.
    // Source: https://leadmagic.io/docs/v1/reference/email-finder
    const consumed = output.credits_consumed
    return typeof consumed === 'number' ? consumed : output.email ? 1 : 0
  }),

  params: {
    first_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Person's first name (use with last_name, or use full_name instead)",
    },
    last_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Person's last name (use with first_name, or use full_name instead)",
    },
    full_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Person's full name (alternative to first_name + last_name)",
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company domain (preferred, e.g. stripe.com)',
    },
    company_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name (fallback if domain is unavailable)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LeadMagic API Key',
    },
  },

  request: {
    url: 'https://api.leadmagic.io/v1/people/email-finder',
    method: 'POST',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, string> = {}
      if (params.first_name) body.first_name = params.first_name
      if (params.last_name) body.last_name = params.last_name
      if (params.full_name) body.full_name = params.full_name
      if (params.domain) body.domain = params.domain
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
        email: data.email ?? null,
        status: data.status ?? null,
        credits_consumed: data.credits_consumed ?? 0,
        message: data.message ?? null,
        employment_verified: data.employment_verified ?? null,
        has_mx: data.has_mx ?? null,
        mx_record: data.mx_record ?? null,
        mx_provider: data.mx_provider ?? null,
        company_name: data.company_name ?? null,
        company_industry: data.company_industry ?? null,
        company_size: data.company_size ?? null,
        company_profile_url: data.company_profile_url ?? null,
      },
    }
  },

  outputs: {
    email: { type: 'string', description: 'Found work email address', optional: true },
    status: { type: 'string', description: 'Result status (valid, invalid, etc.)', optional: true },
    credits_consumed: { type: 'number', description: 'Credits charged (1 when email found)' },
    message: { type: 'string', description: 'Human-readable status message', optional: true },
    employment_verified: {
      type: 'boolean',
      description: 'Whether employment at the company was verified',
      optional: true,
    },
    has_mx: {
      type: 'boolean',
      description: 'Whether the domain has a valid MX record',
      optional: true,
    },
    mx_record: { type: 'string', description: 'MX record for the email domain', optional: true },
    mx_provider: { type: 'string', description: 'Email provider', optional: true },
    company_name: { type: 'string', description: 'Company name', optional: true },
    company_industry: { type: 'string', description: 'Company industry', optional: true },
    company_size: { type: 'string', description: 'Company size range', optional: true },
    company_profile_url: {
      type: 'string',
      description: 'Company LinkedIn/B2B profile URL',
      optional: true,
    },
  },
}
