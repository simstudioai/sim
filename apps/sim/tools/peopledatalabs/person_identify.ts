import type {
  PdlPersonIdentifyParams,
  PdlPersonIdentifyResponse,
} from '@/tools/peopledatalabs/types'
import { PDL_PERSON_OUTPUT_PROPERTIES } from '@/tools/peopledatalabs/types'
import { buildQueryString, projectPerson } from '@/tools/peopledatalabs/utils'
import type { OutputProperty, ToolConfig } from '@/tools/types'

const IDENTIFY_MATCH_PROPERTIES = {
  match_score: { type: 'number', description: 'Match confidence score (1-99)' },
  matched_on: {
    type: 'array',
    description: 'Fields that drove the match (only when include_if_matched=true)',
    optional: true,
    items: { type: 'string', description: 'Field name' },
  },
  person: {
    type: 'object',
    description: 'Person record',
    properties: PDL_PERSON_OUTPUT_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

export const personIdentifyTool: ToolConfig<PdlPersonIdentifyParams, PdlPersonIdentifyResponse> = {
  id: 'pdl_person_identify',
  name: 'PDL Person Identify',
  description:
    'Return up to 20 candidate person matches with confidence scores. Useful when you want to see all plausible matches rather than the single best one. Reference: https://docs.peopledatalabs.com/docs/identify-api-quickstart',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'People Data Labs API key',
    },
    email: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Email' },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number',
    },
    profile: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL',
    },
    email_hash: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SHA-256 email hash',
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
      description: 'Full name',
    },
    first_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First name',
    },
    middle_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Middle name',
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
    school: { type: 'string', required: false, visibility: 'user-or-llm', description: 'School' },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Location',
    },
    street_address: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Street address',
    },
    locality: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'City',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'State/region',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country',
    },
    postal_code: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Postal code',
    },
    birth_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Birth date (YYYY-MM-DD)',
    },
    data_include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated fields to include in each match',
    },
    include_if_matched: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include `matched_on` for each match',
    },
  },

  request: {
    url: (params) => {
      const qs = buildQueryString({
        email: params.email,
        phone: params.phone,
        profile: params.profile,
        email_hash: params.email_hash,
        lid: params.lid,
        name: params.name,
        first_name: params.first_name,
        middle_name: params.middle_name,
        last_name: params.last_name,
        company: params.company,
        school: params.school,
        location: params.location,
        street_address: params.street_address,
        locality: params.locality,
        region: params.region,
        country: params.country,
        postal_code: params.postal_code,
        birth_date: params.birth_date,
        data_include: params.data_include,
        include_if_matched: params.include_if_matched,
      })
      return `https://api.peopledatalabs.com/v5/person/identify${qs}`
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
      return { success: true, output: { matches: [] } }
    }

    if (!response.ok) {
      const error = (data.error as { message?: string })?.message
      throw new Error(error || `People Data Labs error: ${response.status}`)
    }

    const matches = (data.matches as Array<Record<string, unknown>>) ?? []
    return {
      success: true,
      output: {
        matches: matches.map((m) => ({
          match_score: (m.match_score as number) ?? 0,
          matched_on: (m.matched_on as string[]) ?? undefined,
          person: projectPerson((m.data as Record<string, unknown>) ?? {}),
        })),
      },
    }
  },

  outputs: {
    matches: {
      type: 'array',
      description: 'Up to 20 candidate matches, ordered by score',
      items: { type: 'object', properties: IDENTIFY_MATCH_PROPERTIES },
    },
  },
}
