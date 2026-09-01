import type {
  CrowdStrikeQueryHostGroupsParams,
  CrowdStrikeQueryHostGroupsResponse,
} from '@/tools/crowdstrike/types'
import type { InternalToolConfig } from '@/tools/types'

export const crowdstrikeQueryHostGroupsTool: InternalToolConfig<
  CrowdStrikeQueryHostGroupsParams,
  CrowdStrikeQueryHostGroupsResponse
> = {
  id: 'crowdstrike_query_host_groups',
  name: 'CrowdStrike Query Host Groups',
  description:
    'Search CrowdStrike Falcon host groups with a Falcon Query Language filter and return their IDs (GET /devices/queries/host-groups/v1). Requires the "Host groups: Read" API scope.',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon API client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon API client secret',
    },
    cloud: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CrowdStrike Falcon cloud region',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Falcon Query Language filter over host group fields',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of host group IDs to return (1-5000)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination offset for the host group query',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort expression such as "name.asc" or "modified_timestamp.desc"',
    },
  },

  operation: {
    input: (params) => ({
      cloud: params.cloud,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      filter: params.filter,
      limit: params.limit,
      offset: params.offset,
      operation: 'crowdstrike_query_host_groups',
      sort: params.sort,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to query CrowdStrike host groups')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    hostGroupIds: {
      type: 'array',
      description: 'Host group IDs matching the query',
      items: { type: 'string' },
    },
    count: {
      type: 'number',
      description: 'Number of host group IDs returned',
    },
    pagination: {
      type: 'json',
      description: 'Pagination metadata (limit, offset, total)',
      optional: true,
      properties: {
        limit: { type: 'number', description: 'Page size used for the query', optional: true },
        offset: { type: 'number', description: 'Offset returned by CrowdStrike', optional: true },
        total: { type: 'number', description: 'Total records available', optional: true },
      },
    },
  },
}
