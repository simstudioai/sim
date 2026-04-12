import type {
  CrowdStrikeQueryBehaviorsParams,
  CrowdStrikeQueryBehaviorsResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeQueryBehaviorsTool: ToolConfig<
  CrowdStrikeQueryBehaviorsParams,
  CrowdStrikeQueryBehaviorsResponse
> = {
  id: 'crowdstrike_query_behaviors',
  name: 'CrowdStrike Query Behaviors',
  description: 'Search CrowdStrike behaviors by filter, sort order, and pagination',
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
      description: 'Falcon Query Language filter for behavior search',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of behavior records to return',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination offset for the behavior query',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort expression for behavior results',
    },
  },

  request: {
    url: '/api/tools/crowdstrike/query',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      cloud: params.cloud,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      filter: params.filter,
      limit: params.limit,
      offset: params.offset,
      operation: 'crowdstrike_query_behaviors',
      sort: params.sort,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to query CrowdStrike behaviors')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    behaviors: {
      type: 'array',
      description: 'Matching CrowdStrike behavior records',
      items: {
        type: 'object',
        properties: {
          behaviorId: { type: 'string', description: 'Behavior identifier', optional: true },
          incidentId: { type: 'string', description: 'Parent incident identifier', optional: true },
          name: { type: 'string', description: 'Behavior name', optional: true },
          createdTimestamp: {
            type: 'string',
            description: 'Behavior creation timestamp',
            optional: true,
          },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of behaviors returned',
    },
    pagination: {
      type: 'json',
      description: 'Pagination metadata (offset, limit, total, expiresAt)',
      optional: true,
      properties: {
        expiresAt: {
          type: 'number',
          description: 'Pagination cursor expiry timestamp',
          optional: true,
        },
        limit: { type: 'number', description: 'Page size used for the query', optional: true },
        offset: { type: 'number', description: 'Offset returned by CrowdStrike', optional: true },
        total: { type: 'number', description: 'Total records available', optional: true },
      },
    },
  },
}
