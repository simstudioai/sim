import { prospeoHosting } from '@/tools/prospeo/hosting'
import {
  extractProspeoError,
  type ProspeoEnrichPersonParams,
  type ProspeoEnrichPersonResponse,
} from '@/tools/prospeo/types'
import type { ToolConfig } from '@/tools/types'

export const enrichPersonTool: ToolConfig<ProspeoEnrichPersonParams, ProspeoEnrichPersonResponse> =
  {
    id: 'prospeo_enrich_person',
    name: 'Prospeo Enrich Person',
    description: 'Enrich a person with complete B2B profile data, email address and mobile.',
    version: '1.0.0',

    hosting: prospeoHosting<ProspeoEnrichPersonParams>((_params, output) => {
      // No charge on a no-match or a repeat enrichment.
      if (output.free_enrichment === true) return 0
      const person = output.person as Record<string, unknown> | null
      if (!person) return 0
      // 10 credits when a mobile is revealed, otherwise 1 for the person match.
      const mobile = person.mobile as { revealed?: boolean } | undefined
      return mobile?.revealed ? 10 : 1
    }),

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Prospeo API key',
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
      full_name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Full name of the person (alternative to first_name + last_name)',
      },
      linkedin_url: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: "Person's public LinkedIn URL",
      },
      email: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Work email of the person',
      },
      company_name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Company name',
      },
      company_website: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Company website',
      },
      company_linkedin_url: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: "Company's public LinkedIn URL",
      },
      person_id: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Prospeo person_id from a previous Search Person response',
      },
      only_verified_email: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Only return records with a verified email',
      },
      enrich_mobile: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Reveal mobile number (10 credits per match; email included)',
      },
      only_verified_mobile: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Only return records that have a mobile (implies enrich_mobile)',
      },
    },

    request: {
      url: 'https://api.prospeo.io/enrich-person',
      method: 'POST',
      headers: (params) => ({
        'X-KEY': params.apiKey,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const data: Record<string, unknown> = {}
        if (params.first_name) data.first_name = params.first_name
        if (params.last_name) data.last_name = params.last_name
        if (params.full_name) data.full_name = params.full_name
        if (params.linkedin_url) data.linkedin_url = params.linkedin_url
        if (params.email) data.email = params.email
        if (params.company_name) data.company_name = params.company_name
        if (params.company_website) data.company_website = params.company_website
        if (params.company_linkedin_url) data.company_linkedin_url = params.company_linkedin_url
        if (params.person_id) data.person_id = params.person_id

        const body: Record<string, unknown> = { data }
        if (params.only_verified_email !== undefined)
          body.only_verified_email = params.only_verified_email
        if (params.enrich_mobile !== undefined) body.enrich_mobile = params.enrich_mobile
        if (params.only_verified_mobile !== undefined)
          body.only_verified_mobile = params.only_verified_mobile
        return body
      },
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        throw new Error(await extractProspeoError(response))
      }
      const data = await response.json()
      return {
        success: true,
        output: {
          free_enrichment: data.free_enrichment ?? false,
          person: data.person ?? null,
          company: data.company ?? null,
        },
      }
    },

    outputs: {
      free_enrichment: {
        type: 'boolean',
        description: 'True if this enrichment was free (already enriched in the past)',
      },
      person: {
        type: 'json',
        description:
          'The matched person object including person_id, name, linkedin_url, current_job_title, job_history, mobile, email, location, and skills',
        optional: true,
      },
      company: {
        type: 'json',
        description:
          'The current company of the matched person including name, website, domain, industry, employee_count, location, social URLs, funding, and technology',
        optional: true,
      },
    },
  }
