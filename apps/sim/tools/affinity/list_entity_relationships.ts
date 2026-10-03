import type {
  AffinityCollectionResponse,
  AffinityListRelationshipsParams,
} from '@/tools/affinity/types'
import { RELATIONSHIP_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  AFFINITY_FIELD_ENTITY_TYPES,
  affinityHeaders,
  buildAffinityUrl,
  parseStringList,
  requireId,
  requireOneOf,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListEntityRelationshipsTool: ToolConfig<
  AffinityListRelationshipsParams,
  AffinityCollectionResponse<'relationships'>
> = {
  id: 'affinity_list_entity_relationships',
  name: 'Affinity List Entity Relationships',
  description:
    'List who knows a company or person, scored 0.0 to 1.0 by how much the two actually interact. Strongest first by default.',
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
      description: 'Which entity to look up relationships for: companies or persons',
    },
    entityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of that company or person',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Affinity Filtering Language expression. This endpoint filters on interactionScore only, e.g. "interactionScore>=0.5"',
    },
    orderBy: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort order: ["interactionScore"] for weakest first, ["-interactionScore"] for strongest first (the default)',
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
      const entityType = requireOneOf(params.entityType, AFFINITY_FIELD_ENTITY_TYPES, 'entityType')
      const entityId = encodeURIComponent(requireId(params.entityId, 'entityId'))
      return buildAffinityUrl(`/${entityType}/${entityId}/relationships`, {
        filter: params.filter,
        orderBy: parseStringList(params.orderBy, 'orderBy'),
        cursor: params.cursor,
        limit: params.limit,
        totalCount: params.totalCount,
      })
    },
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('relationships'),

  outputs: {
    relationships: {
      type: 'array',
      description: 'Scored relationships involving the entity',
      items: { type: 'object', properties: RELATIONSHIP_OUTPUT_PROPERTIES },
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
