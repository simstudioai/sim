import type {
  AffinityCollectionResponse,
  AffinitySearchEntitiesParams,
} from '@/tools/affinity/types'
import { PERSON_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  buildSearchBody,
  parseStringList,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinitySearchPersonsTool: ToolConfig<
  AffinitySearchEntitiesParams,
  AffinityCollectionResponse<'persons'>
> = {
  id: 'affinity_search_persons',
  name: 'Affinity Search Persons',
  description:
    'Search persons by filters, sorts, and a free-text term. Requires the "Export All People directory" permission.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter group as {operator: "and"|"or", filters: [...]}, at most 50 leaves. Each leaf is {valueType, fieldId, operator, value}, and a leaf may itself be a nested group',
    },
    searchTerm: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-text term matched against the searchable fields. At least 3 characters',
    },
    searchFieldIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field IDs the search term is matched against. Defaults to the searchable fields',
    },
    sorts: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort order as [{fieldId, direction: "asc"|"desc", attributeId?}], up to 5, applied in order',
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
    url: (params) =>
      buildAffinityUrl('/persons/search', {
        fieldIds: parseStringList(params.fieldIds, 'fieldIds'),
        fieldTypes: parseStringList(params.fieldTypes, 'fieldTypes'),
        cursor: params.cursor,
        limit: params.limit,
        totalCount: params.totalCount,
      }),
    method: 'POST',
    headers: (params) => affinityHeaders(params.apiKey, true),
    body: (params) => buildSearchBody(params),
  },

  transformResponse: transformCollection('persons'),

  outputs: {
    persons: {
      type: 'array',
      description: 'Matching persons with any requested field values',
      items: { type: 'object', properties: PERSON_OUTPUT_PROPERTIES },
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
