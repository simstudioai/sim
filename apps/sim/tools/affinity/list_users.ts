import type { AffinityCollectionResponse, AffinityListUsersParams } from '@/tools/affinity/types'
import { USER_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import { affinityHeaders, buildAffinityUrl, transformCollection } from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListUsersTool: ToolConfig<
  AffinityListUsersParams,
  AffinityCollectionResponse<'users'>
> = {
  id: 'affinity_list_users',
  name: 'Affinity List Users',
  description:
    'Page through the internal users in the organization. Email addresses and roles are returned only to callers with the "Manage Users" permission.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    term: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Case-insensitive match across first name, last name, and primary email',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Affinity Filtering Language expression over id or status, e.g. "status=active"',
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
      buildAffinityUrl('/users', {
        term: params.term,
        filter: params.filter,
        cursor: params.cursor,
        limit: params.limit,
      }),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('users'),

  outputs: {
    users: {
      type: 'array',
      description: 'Internal users in the organization',
      items: { type: 'object', properties: USER_OUTPUT_PROPERTIES },
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
