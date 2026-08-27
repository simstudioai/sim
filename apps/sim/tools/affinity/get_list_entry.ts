import type { AffinityEntityResponse, AffinityGetListEntryParams } from '@/tools/affinity/types'
import { LIST_ENTRY_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  parseStringList,
  requireId,
  transformEntity,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityGetListEntryTool: ToolConfig<
  AffinityGetListEntryParams,
  AffinityEntityResponse<Record<string, unknown>>
> = {
  id: 'affinity_get_list_entry',
  name: 'Affinity Get List Entry',
  description:
    'Read one row of a list with its entity. Field data is returned only for the Field IDs or Field Types asked for.',
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
        'Field categories to return values for: enriched, global, list, or relationship-intelligence. Mutually exclusive with Field IDs',
    },
  },

  request: {
    url: (params) => {
      const listId = encodeURIComponent(requireId(params.listId, 'listId'))
      const listEntryId = encodeURIComponent(requireId(params.listEntryId, 'listEntryId'))
      return buildAffinityUrl(`/lists/${listId}/list-entries/${listEntryId}`, {
        fieldIds: parseStringList(params.fieldIds, 'fieldIds'),
        fieldTypes: parseStringList(params.fieldTypes, 'fieldTypes'),
      })
    },
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformEntity(),

  outputs: LIST_ENTRY_OUTPUT_PROPERTIES,
}
