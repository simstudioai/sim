import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  HARMONIC_CONTACT_OUTPUT_PROPERTIES,
  type HarmonicBatchGetPeopleParams,
  type HarmonicBatchGetPeopleResponse,
} from '@/tools/harmonic/types'
import {
  buildBatchGetPeopleBody,
  HARMONIC_API_BASE,
  harmonicHeaders,
  normalizePersonArray,
} from '@/tools/harmonic/utils'
import type { ToolConfig } from '@/tools/types'

export const harmonicBatchGetPeopleTool: ToolConfig<
  HarmonicBatchGetPeopleParams,
  HarmonicBatchGetPeopleResponse
> = {
  id: 'harmonic_batch_get_people',
  name: 'Harmonic Batch Get People',
  description:
    'Fetch full Harmonic person profiles for up to 500 combined numeric IDs and person URNs.',
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
    personIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of numeric Harmonic person IDs; may be a JSON-array string',
    },
    personUrns: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of Harmonic person URNs; may be a JSON-array string',
    },
  },

  request: {
    url: `${HARMONIC_API_BASE}/persons/batchGet`,
    method: 'POST',
    headers: (params) => harmonicHeaders(params.accessToken, { json: true }),
    body: (params) => buildBatchGetPeopleBody(params.personIds, params.personUrns),
  },

  transformResponse: async (response) => {
    const contacts = normalizePersonArray(await response.json())
    return { success: true, output: { contacts, count: contacts.length } }
  },

  outputs: {
    contacts: {
      type: 'array',
      description: 'Fetched Harmonic person profiles normalized as contacts',
      items: { type: 'object', properties: HARMONIC_CONTACT_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of contacts returned' },
  },
}
