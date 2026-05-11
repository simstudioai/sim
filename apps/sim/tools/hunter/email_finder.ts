import type { HunterEmailFinderParams, HunterEmailFinderResponse } from '@/tools/hunter/types'
import { SOURCES_OUTPUT, VERIFICATION_OUTPUT } from '@/tools/hunter/types'
import type { ToolConfig } from '@/tools/types'

export const emailFinderTool: ToolConfig<HunterEmailFinderParams, HunterEmailFinderResponse> = {
  id: 'hunter_email_finder',
  name: 'Hunter Email Finder',
  description:
    'Finds the most likely email address for a person given their name and company domain.',
  version: '1.0.0',

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company domain name (e.g., "stripe.com", "company.io")',
    },
    first_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Person\'s first name (e.g., "John", "Sarah")',
    },
    last_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Person\'s last name (e.g., "Smith", "Johnson")',
    },
    company: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name (e.g., "Stripe", "Acme Inc")',
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
      const url = new URL('https://api.hunter.io/v2/email-finder')
      url.searchParams.append('domain', params.domain)
      url.searchParams.append('first_name', params.first_name)
      url.searchParams.append('last_name', params.last_name)
      url.searchParams.append('api_key', params.apiKey)

      if (params.company) url.searchParams.append('company', params.company)

      return url.toString()
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const d = data.data ?? {}

    return {
      success: true,
      output: {
        first_name: d.first_name ?? '',
        last_name: d.last_name ?? '',
        email: d.email ?? '',
        score: d.score ?? 0,
        domain: d.domain ?? '',
        accept_all: d.accept_all ?? false,
        position: d.position ?? null,
        twitter: d.twitter ?? null,
        linkedin_url: d.linkedin_url ?? null,
        phone_number: d.phone_number ?? null,
        company: d.company ?? null,
        sources: d.sources ?? [],
        verification: d.verification ?? { date: null, status: 'unknown' },
      },
    }
  },

  outputs: {
    first_name: { type: 'string', description: "Person's first name" },
    last_name: { type: 'string', description: "Person's last name" },
    email: { type: 'string', description: 'The found email address' },
    score: {
      type: 'number',
      description: 'Confidence score (0-100) for the found email address',
    },
    domain: { type: 'string', description: 'Domain that was searched' },
    accept_all: {
      type: 'boolean',
      description: 'Whether the server accepts all email addresses (may cause false positives)',
    },
    position: { type: 'string', description: 'Job title/position', optional: true },
    twitter: { type: 'string', description: 'Twitter handle', optional: true },
    linkedin_url: { type: 'string', description: 'LinkedIn profile URL', optional: true },
    phone_number: { type: 'string', description: 'Phone number', optional: true },
    company: { type: 'string', description: 'Company name', optional: true },
    sources: SOURCES_OUTPUT,
    verification: VERIFICATION_OUTPUT,
  },
}
