import {
  SAILPOINT_QUERY_ROUTE,
  sailpointCredentialParams,
  sailpointPaginationParams,
  sailpointSearchOutputs,
  unwrapSailPointOutput,
} from '@/tools/sailpoint/common'
import type {
  SailPointSearchOutput,
  SailPointSearchParams,
  SailPointSearchResponse,
} from '@/tools/sailpoint/types'
import type { ToolConfig } from '@/tools/types'

export const sailpointSearchTool: ToolConfig<SailPointSearchParams, SailPointSearchResponse> = {
  id: 'sailpoint_search',
  name: 'SailPoint Search',
  description:
    'Run a global search across SailPoint indices (identities, entitlements, roles, access profiles, account activities, events). Set includeNested to return nested access[] on identities.',
  version: '1.0.0',

  params: {
    ...sailpointCredentialParams,
    indices: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Indices to search: identities, accessprofiles, accountactivities, entitlements, events, roles, or * (defaults to ["identities"])',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Elasticsearch query string (e.g. "attributes.department:Engineering")',
    },
    sort: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort fields, e.g. ["displayName","+id"]',
    },
    searchAfter: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'searchAfter cursor for deep pagination beyond 10,000 records',
    },
    includeNested: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include nested objects (e.g. identity access[]) in results. Defaults to true.',
    },
    ...sailpointPaginationParams,
  },

  request: {
    url: SAILPOINT_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'sailpoint_search',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      tenant: params.tenant,
      apiVersion: params.apiVersion,
      indices: params.indices,
      query: params.query,
      sort: params.sort,
      searchAfter: params.searchAfter,
      includeNested: params.includeNested,
      limit: params.limit,
      offset: params.offset,
      count: params.count,
    }),
  },

  transformResponse: (response) => unwrapSailPointOutput<SailPointSearchOutput>(response),

  outputs: sailpointSearchOutputs,
}
