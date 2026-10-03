import type {
  AffinityCollectionResponse,
  AffinityListEntityFieldValuesParams,
} from '@/tools/affinity/types'
import { FIELD_VALUE_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  AFFINITY_FIELD_ENTITY_TYPES,
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  requireOneOf,
  selectFieldScope,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListEntityFieldValuesTool: ToolConfig<
  AffinityListEntityFieldValuesParams,
  AffinityCollectionResponse<'fields'>
> = {
  id: 'affinity_list_entity_field_values',
  name: 'Affinity List Entity Field Values',
  description:
    "Page through a company's or person's non-list field values. List fields are not returned here — read those through the list entry.",
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
      description: 'Which entity to read field values from: companies or persons',
    },
    entityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of that company or person',
    },
    ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict to these field IDs. Mutually exclusive with Field Types',
    },
    types: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Restrict to these field categories: enriched, global, relationship-intelligence. Mutually exclusive with Field IDs',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from a previous page, returned as nextCursor or prevCursor',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of items to return per page, 1-100. Defaults to 20',
    },
  },

  request: {
    url: (params) => {
      const entityType = requireOneOf(params.entityType, AFFINITY_FIELD_ENTITY_TYPES, 'entityType')
      const entityId = encodeURIComponent(requireId(params.entityId, 'entityId'))
      return buildAffinityUrl(`/${entityType}/${entityId}/fields`, {
        ...selectFieldScope(params.ids, params.types),
        cursor: params.cursor,
        limit: params.limit,
      })
    },
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('fields'),

  outputs: {
    fields: {
      type: 'array',
      description: 'Field values on the entity',
      items: { type: 'object', properties: FIELD_VALUE_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of rows on this page' },
    nextCursor: {
      type: 'string',
      nullable: true,
      description: 'Cursor for the next page, or null on the last page',
    },
    prevCursor: {
      type: 'string',
      nullable: true,
      description: 'Cursor for the previous page, or null on the first page',
    },
  },
}
