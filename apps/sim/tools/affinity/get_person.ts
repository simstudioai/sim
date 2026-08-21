import type { AffinityEntityResponse, AffinityGetPersonParams } from '@/tools/affinity/types'
import { PERSON_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  parseStringList,
  requireId,
  transformEntity,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityGetPersonTool: ToolConfig<
  AffinityGetPersonParams,
  AffinityEntityResponse<Record<string, unknown>>
> = {
  id: 'affinity_get_person',
  name: 'Affinity Get Person',
  description:
    'Look up one person by ID. Field data is returned only for the Field IDs or Field Types asked for.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    personId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The person ID',
    },
    fieldIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field IDs to return values for, e.g. ["affinity-data-location"]. Mutually exclusive with Field Types',
    },
    fieldTypes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field categories to return values for: enriched, global, or relationship-intelligence. Mutually exclusive with Field IDs',
    },
  },

  request: {
    url: (params) =>
      buildAffinityUrl(`/persons/${encodeURIComponent(requireId(params.personId, 'personId'))}`, {
        fieldIds: parseStringList(params.fieldIds, 'fieldIds'),
        fieldTypes: parseStringList(params.fieldTypes, 'fieldTypes'),
      }),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformEntity(),

  outputs: PERSON_OUTPUT_PROPERTIES,
}
