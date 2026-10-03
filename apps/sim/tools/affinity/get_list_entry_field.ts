import type {
  AffinityEntityResponse,
  AffinityGetListEntryFieldParams,
} from '@/tools/affinity/types'
import { FIELD_VALUE_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  requireParam,
  transformEntity,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityGetListEntryFieldTool: ToolConfig<
  AffinityGetListEntryFieldParams,
  AffinityEntityResponse<Record<string, unknown>>
> = {
  id: 'affinity_get_list_entry_field',
  name: 'Affinity Get List Entry Field',
  description: 'Read one field value on a list row.',
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
      description: 'The field ID to read',
    },
  },

  request: {
    url: (params) => {
      const listId = encodeURIComponent(requireId(params.listId, 'listId'))
      const listEntryId = encodeURIComponent(requireId(params.listEntryId, 'listEntryId'))
      const fieldId = encodeURIComponent(requireParam(params.fieldId, 'fieldId'))
      return buildAffinityUrl(`/lists/${listId}/list-entries/${listEntryId}/fields/${fieldId}`)
    },
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformEntity(),

  outputs: FIELD_VALUE_OUTPUT_PROPERTIES,
}
