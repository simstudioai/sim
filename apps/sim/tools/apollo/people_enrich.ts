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
      description: 'Reveal phone numbers (uses credits)',
    },
  },

  request: {
    url: 'https://api.apollo.io/api/v1/people/match',
    method: 'POST',
    headers: (params: ApolloPeopleEnrichParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloPeopleEnrichParams) => {
      const body: any = {}

      if (params.first_name) body.first_name = params.first_name
      if (params.last_name) body.last_name = params.last_name
      if (params.email) body.email = params.email
      if (params.organization_name) body.organization_name = params.organization_name
      if (params.domain) body.domain = params.domain
      if (params.linkedin_url) body.linkedin_url = params.linkedin_url
      if (params.reveal_personal_emails !== undefined) {
        body.reveal_personal_emails = params.reveal_personal_emails
      }
      if (params.reveal_phone_number !== undefined) {
        body.reveal_phone_number = params.reveal_phone_number
      }

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
        person: data.person || {},
        enriched: !!data.person,
      },
    }
  },

  outputs: {
    person: { type: 'json', description: 'Enriched person data from Apollo' },
    enriched: { type: 'boolean', description: 'Whether the person was successfully enriched' },
  },
}
