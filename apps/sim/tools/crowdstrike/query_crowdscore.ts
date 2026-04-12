import type {
  CrowdStrikeQueryCrowdScoreParams,
  CrowdStrikeQueryCrowdScoreResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeQueryCrowdScoreTool: ToolConfig<
  CrowdStrikeQueryCrowdScoreParams,
  CrowdStrikeQueryCrowdScoreResponse
> = {
  id: 'crowdstrike_query_crowdscore',
  name: 'CrowdStrike Query CrowdScore',
  description: 'Retrieve environment-wide CrowdScore entities from CrowdStrike Falcon',
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
      description: 'Falcon Query Language filter for CrowdScore search',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of CrowdScore records to return',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination offset for CrowdScore results',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort expression for CrowdScore results',
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
      operation: 'crowdstrike_query_crowdscore',
      sort: params.sort,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to query CrowdStrike CrowdScore')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    crowdScores: {
      type: 'array',
      description: 'CrowdStrike CrowdScore entities',
      items: {
        type: 'object',
        properties: {
          entityId: { type: 'string', description: 'Entity identifier', optional: true },
          entityType: { type: 'string', description: 'Entity type', optional: true },
          lastUpdated: { type: 'string', description: 'Last update timestamp', optional: true },
          score: { type: 'number', description: 'CrowdScore value', optional: true },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of CrowdScore records returned',
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
