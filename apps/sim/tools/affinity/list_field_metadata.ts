import type {
  AffinityCollectionResponse,
  AffinityListFieldMetadataParams,
} from '@/tools/affinity/types'
import { FIELD_METADATA_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  AFFINITY_FIELD_ENTITY_TYPES,
  affinityHeaders,
  buildAffinityUrl,
  parseStringList,
  requireOneOf,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListFieldMetadataTool: ToolConfig<
  AffinityListFieldMetadataParams,
  AffinityCollectionResponse<'fields'>
> = {
  id: 'affinity_list_field_metadata',
  name: 'Affinity List Field Metadata',
  description:
    'List the non-list company or person fields, with the value type, filter operators, and sort support of each. Start here to find the Field IDs the read and write tools take.',
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
      description: 'Which fields to describe: companies or persons',
    },
    includes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Extra properties to return: ["filterability","sortability"]. Both are omitted unless requested here',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Affinity Filtering Language expression. This endpoint filters on name only, e.g. "name=~Status"',
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
  },

  request: {
    url: (params) =>
      buildAffinityUrl(
        `/${requireOneOf(params.entityType, AFFINITY_FIELD_ENTITY_TYPES, 'entityType')}/fields`,
        {
          includes: parseStringList(params.includes, 'includes'),
          filter: params.filter,
          cursor: params.cursor,
          limit: params.limit,
        }
      ),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('fields'),

  outputs: {
    fields: {
      type: 'array',
      description: 'Field definitions available on the entity',
      items: { type: 'object', properties: FIELD_METADATA_OUTPUT_PROPERTIES },
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
