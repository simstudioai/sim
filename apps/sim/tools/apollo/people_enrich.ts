import type { ApolloPeopleEnrichParams, ApolloPeopleEnrichResponse } from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloPeopleEnrichTool: ToolConfig<
  ApolloPeopleEnrichParams,
  ApolloPeopleEnrichResponse
> = {
  id: 'apollo_people_enrich',
  name: 'Apollo People Enrichment',
  description: 'Enrich data for a single person using Apollo',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key',
    },
    first_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name of the person',
    },
    last_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name of the person',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full name of the person (alternative to first_name/last_name)',
    },
    id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Apollo ID for the person',
    },
    hashed_email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'MD5 or SHA-256 hashed email',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address of the person',
    },
    organization_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name where the person works',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company domain (e.g., "apollo.io", "acme.com")',
    },
    linkedin_url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL',
    },
    reveal_personal_emails: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Reveal personal email addresses (uses credits)',
    },
    reveal_phone_number: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Reveal phone numbers (uses credits, requires webhook_url)',
    },
    webhook_url: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Webhook URL for async phone number delivery (required when reveal_phone_number is true)',
    },
  },

  request: {
    url: (params: ApolloPeopleEnrichParams) => {
      const qs = new URLSearchParams()
      if (params.reveal_personal_emails !== undefined) {
        qs.set('reveal_personal_emails', String(params.reveal_personal_emails))
      }
      if (params.reveal_phone_number !== undefined) {
        qs.set('reveal_phone_number', String(params.reveal_phone_number))
      }
      if (params.webhook_url) {
        qs.set('webhook_url', params.webhook_url)
      }
      const query = qs.toString()
      return `https://api.apollo.io/api/v1/people/match${query ? `?${query}` : ''}`
    },
    method: 'POST',
    headers: (params: ApolloPeopleEnrichParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloPeopleEnrichParams) => {
      const body: Record<string, unknown> = {}

      if (params.first_name) body.first_name = params.first_name
      if (params.last_name) body.last_name = params.last_name
      if (params.name) body.name = params.name
      if (params.email) body.email = params.email
      if (params.hashed_email) body.hashed_email = params.hashed_email
      if (params.id) body.id = params.id
      if (params.organization_name) body.organization_name = params.organization_name
      if (params.domain) body.domain = params.domain
      if (params.linkedin_url) body.linkedin_url = params.linkedin_url

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Apollo API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        person: data.person ?? null,
        enriched: !!data.person,
      },
    }
  },

  outputs: {
    person: {
      type: 'json',
      description: 'Enriched person data from Apollo',
      optional: true,
    },
    enriched: { type: 'boolean', description: 'Whether the person was successfully enriched' },
  },
}
