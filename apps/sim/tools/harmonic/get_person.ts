import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  HARMONIC_CONTACT_OUTPUT_PROPERTIES,
  type HarmonicGetPersonParams,
  type HarmonicGetPersonResponse,
} from '@/tools/harmonic/types'
import { buildGetPersonUrl, harmonicHeaders, normalizeOptionalPerson } from '@/tools/harmonic/utils'
import type { ToolConfig } from '@/tools/types'

export const harmonicGetPersonTool: ToolConfig<HarmonicGetPersonParams, HarmonicGetPersonResponse> =
  {
    id: 'harmonic_get_person',
    name: 'Harmonic Get Person',
    description:
      'Fetch one Harmonic person by numeric ID or URN, including any email resolved by a completed enrichment job.',
    version: '1.0.0',
    oauth: { required: true, provider: 'harmonic' },
    errorExtractor: ErrorExtractorId.HARMONIC_ERRORS,

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'Harmonic credential resolved by the connected account',
      },
      personId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Harmonic person ID or full person URN',
      },
      companyContextUrns: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Company URNs used to scope the returned experience context; may be a JSON-array string',
      },
    },

    request: {
      url: (params) => buildGetPersonUrl(params.personId, params.companyContextUrns),
      method: 'GET',
      headers: (params) => harmonicHeaders(params.accessToken),
    },

    transformResponse: async (response) => {
      const contact = normalizeOptionalPerson(await response.json())
      return { success: true, output: { contact, found: contact !== null } }
    },

    outputs: {
      contact: {
        type: 'object',
        nullable: true,
        description: 'Normalized Harmonic contact, or null when Harmonic has no such person',
        properties: HARMONIC_CONTACT_OUTPUT_PROPERTIES,
      },
      found: { type: 'boolean', description: 'Whether Harmonic returned a person profile' },
    },
  }
