import type { AffinityCollectionResponse, AffinityListPersonsParams } from '@/tools/affinity/types'
import { PERSON_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  parseNumberList,
  parseStringList,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListPersonsTool: ToolConfig<
  AffinityListPersonsParams,
  AffinityCollectionResponse<'persons'>
> = {
  id: 'affinity_list_persons',
  name: 'Affinity List Persons',
  description:
    'Page through persons. Persons come back without field data unless Field IDs or Field Types asks for it.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict the page to these person IDs, e.g. [1, 2, 3]',
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
  },

  request: {
    url: (params) =>
      buildAffinityUrl('/persons', {
        ids: parseNumberList(params.ids, 'ids'),
        fieldIds: parseStringList(params.fieldIds, 'fieldIds'),
        fieldTypes: parseStringList(params.fieldTypes, 'fieldTypes'),
        cursor: params.cursor,
        limit: params.limit,
      }),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('persons'),

  outputs: {
    persons: {
      type: 'array',
      description: 'Persons with any requested field values',
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
  },
}
