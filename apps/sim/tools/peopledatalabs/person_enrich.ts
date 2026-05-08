import type { PdlPersonEnrichParams, PdlPersonEnrichResponse } from '@/tools/peopledatalabs/types'
import { PDL_PERSON_OUTPUT_PROPERTIES } from '@/tools/peopledatalabs/types'
import { buildQueryString, projectPerson } from '@/tools/peopledatalabs/utils'
import type { ToolConfig } from '@/tools/types'

export const personEnrichTool: ToolConfig<PdlPersonEnrichParams, PdlPersonEnrichResponse> = {
  id: 'pdl_person_enrich',
  name: 'PDL Person Enrich',
  description:
    'Enrich a single person profile using People Data Labs. Match by email, phone, LinkedIn URL, or name + company/location. Returns work history, contact details, location, and skills.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'People Data Labs API key',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address to match',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number (E.164 format preferred)',
    },
    profile: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL',
    },
    lid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn numeric ID',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Full name (use as an alternative to first_name + last_name)',
    },
    first_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name (use with last_name + company or location)',
    },
    last_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last name',
    },
    company: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name or website',
    },
    school: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'School name',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Location name (city, region, or country)',
    },
    min_likelihood: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum match likelihood (1-10)',
    },
    required: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Required-fields expression (e.g., "emails AND job_title")',
    },
  },

  request: {
    url: (params) => {
      const qs = buildQueryString({
        email: params.email,
        phone: params.phone,
        profile: params.profile,
        lid: params.lid,
        name: params.name,
        first_name: params.first_name,
        last_name: params.last_name,
        company: params.company,
        school: params.school,
        location: params.location,
        min_likelihood: params.min_likelihood,
        required: params.required,
      })
      return `https://api.peopledatalabs.com/v5/person/enrich${qs}`
    },
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as Record<string, unknown>
    const status = (data.status as number) ?? response.status

    if (status === 404) {
      return {
        success: true,
        output: { matched: false, likelihood: null, person: null },
      }
    }

    if (!response.ok) {
      const error = (data.error as { message?: string })?.message
      throw new Error(error || `People Data Labs error: ${response.status}`)
    }

    const record = (data.data as Record<string, unknown>) ?? null
    return {
      success: true,
      output: {
        matched: record !== null,
        likelihood: (data.likelihood as number) ?? null,
        person: record ? projectPerson(record) : null,
      },
    }
  },

  outputs: {
    matched: { type: 'boolean', description: 'Whether a person record was matched' },
    likelihood: {
      type: 'number',
      description: 'Match likelihood score (1-10), null if no match',
      optional: true,
    },
    person: {
      type: 'object',
      description: 'Matched person record',
      optional: true,
      properties: PDL_PERSON_OUTPUT_PROPERTIES,
    },
  },
}
