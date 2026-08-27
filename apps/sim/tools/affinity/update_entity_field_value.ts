import type {
  AffinityAcknowledgementResponse,
  AffinityUpdateEntityFieldValueParams,
} from '@/tools/affinity/types'
import { ACKNOWLEDGEMENT_OUTPUTS } from '@/tools/affinity/types'
import {
  AFFINITY_FIELD_ENTITY_TYPES,
  affinityHeaders,
  buildAffinityUrl,
  parseOptionalJsonObject,
  requireId,
  requireOneOf,
  requireParam,
  transformAcknowledgement,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityUpdateEntityFieldValueTool: ToolConfig<
  AffinityUpdateEntityFieldValueParams,
  AffinityAcknowledgementResponse
> = {
  id: 'affinity_update_entity_field_value',
  name: 'Affinity Update Entity Field Value',
  description:
    'Write one non-list field value on a company or person. The value type must match how the field is defined.',
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
      description: 'Which entity to write the field on: companies or persons',
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
      description: 'The field ID to write',
    },
    value: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The new value as {type, data}, where type matches the field\'s value type. Examples: {"type":"text","data":"Series B"}, {"type":"number","data":42}, {"type":"dropdown","data":{"dropdownOptionId":7}}, {"type":"person","data":{"id":123}}, {"type":"person-multi","data":[{"id":123}]}. Pass data as null to clear the field',
    },
  },

  request: {
    url: (params) => {
      const entityType = requireOneOf(params.entityType, AFFINITY_FIELD_ENTITY_TYPES, 'entityType')
      const entityId = encodeURIComponent(requireId(params.entityId, 'entityId'))
      const fieldId = encodeURIComponent(requireParam(params.fieldId, 'fieldId'))
      return buildAffinityUrl(`/${entityType}/${entityId}/fields/${fieldId}`)
    },
    method: 'POST',
    headers: (params) => affinityHeaders(params.apiKey, true),
    body: (params) => {
      const value = parseOptionalJsonObject(params.value, 'value')
      if (!value) throw new Error('Affinity "value" is required')
      return { value }
    },
  },

  transformResponse: transformAcknowledgement((params) => String(params.fieldId ?? '')),

  outputs: ACKNOWLEDGEMENT_OUTPUTS,
}
