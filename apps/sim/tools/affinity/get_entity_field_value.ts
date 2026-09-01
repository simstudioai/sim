import type {
  AffinityEntityResponse,
  AffinityGetEntityFieldValueParams,
} from '@/tools/affinity/types'
import { FIELD_VALUE_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  AFFINITY_FIELD_ENTITY_TYPES,
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  requireOneOf,
  requireParam,
  transformEntity,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityGetEntityFieldValueTool: ToolConfig<
  AffinityGetEntityFieldValueParams,
  AffinityEntityResponse<Record<string, unknown>>
> = {
  id: 'affinity_get_entity_field_value',
  name: 'Affinity Get Entity Field Value',
  description: 'Read one non-list field value from a company or person.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    entityType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Which entity to read the field from: companies or persons',
    },
    entityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of that company or person',
    },
    fieldId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The field ID to read',
    },
  },

  request: {
    url: (params) => {
      const entityType = requireOneOf(params.entityType, AFFINITY_FIELD_ENTITY_TYPES, 'entityType')
      const entityId = encodeURIComponent(requireId(params.entityId, 'entityId'))
      const fieldId = encodeURIComponent(requireParam(params.fieldId, 'fieldId'))
      return buildAffinityUrl(`/${entityType}/${entityId}/fields/${fieldId}`)
    },
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformEntity(),

  outputs: FIELD_VALUE_OUTPUT_PROPERTIES,
}
