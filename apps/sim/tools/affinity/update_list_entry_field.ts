import type {
  AffinityAcknowledgementResponse,
  AffinityUpdateListEntryFieldParams,
} from '@/tools/affinity/types'
import { ACKNOWLEDGEMENT_OUTPUTS } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  parseOptionalJsonObject,
  requireId,
  requireParam,
  transformAcknowledgement,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityUpdateListEntryFieldTool: ToolConfig<
  AffinityUpdateListEntryFieldParams,
  AffinityAcknowledgementResponse
> = {
  id: 'affinity_update_list_entry_field',
  name: 'Affinity Update List Entry Field',
  description:
    'Write one field value on a list row. Requires the "Export data from Lists" permission.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The list ID',
    },
    listEntryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The list entry ID',
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
      const listId = encodeURIComponent(requireId(params.listId, 'listId'))
      const listEntryId = encodeURIComponent(requireId(params.listEntryId, 'listEntryId'))
      const fieldId = encodeURIComponent(requireParam(params.fieldId, 'fieldId'))
      return buildAffinityUrl(`/lists/${listId}/list-entries/${listEntryId}/fields/${fieldId}`)
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
