import type { AffinityCollectionResponse, AffinityEntityScopedParams } from '@/tools/affinity/types'
import { NOTE_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  AFFINITY_NOTE_ENTITY_TYPES,
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  requireOneOf,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListEntityNotesTool: ToolConfig<
  AffinityEntityScopedParams,
  AffinityCollectionResponse<'notes'>
> = {
  id: 'affinity_list_entity_notes',
  name: 'Affinity List Entity Notes',
  description:
    'List the notes relevant to one company, person, or opportunity — directly attached notes plus notes reaching it through its people and meetings.',
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
      description: 'Which entity the notes hang off: companies, persons, or opportunities',
    },
    entityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of that company, person, or opportunity',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Affinity Filtering Language expression, e.g. "createdAt>=2026-01-01"',
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
      description: 'Number of items to return per page, 1-100. Defaults to 100',
    },
    totalCount: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include the total size of the collection. Costs an extra query',
    },
  },

  request: {
    url: (params) => {
      const entityType = requireOneOf(params.entityType, AFFINITY_NOTE_ENTITY_TYPES, 'entityType')
      const entityId = encodeURIComponent(requireId(params.entityId, 'entityId'))
      return buildAffinityUrl(`/${entityType}/${entityId}/notes`, {
        filter: params.filter,
        cursor: params.cursor,
        limit: params.limit,
        totalCount: params.totalCount,
      })
    },
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('notes'),

  outputs: {
    notes: {
      type: 'array',
      description: 'Notes relevant to the entity',
      items: { type: 'object', properties: NOTE_OUTPUT_PROPERTIES },
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
    totalCount: {
      type: 'number',
      nullable: true,
      description: 'Total size of the collection, only when Total Count was requested',
    },
  },
}
