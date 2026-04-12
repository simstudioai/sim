import type {
  CrowdStrikeQuerySensorsParams,
  CrowdStrikeQuerySensorsResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeQuerySensorsTool: ToolConfig<
  CrowdStrikeQuerySensorsParams,
  CrowdStrikeQuerySensorsResponse
> = {
  id: 'crowdstrike_query_sensors',
  name: 'CrowdStrike Query Sensors',
  description: 'Search CrowdStrike identity protection sensors by hostname, IP, or related fields',
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
      description: 'Falcon Query Language filter for identity sensor search',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of sensor records to return',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination offset for the identity sensor query',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort expression for identity sensor results',
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
      operation: 'crowdstrike_query_sensors',
      sort: params.sort,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to query CrowdStrike sensors')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    sensors: {
      type: 'array',
      description: 'Matching CrowdStrike identity sensor records',
      items: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Sensor agent identifier', optional: true },
          hostname: { type: 'string', description: 'Sensor hostname', optional: true },
          ipAddress: { type: 'string', description: 'Sensor IP address', optional: true },
          macAddress: { type: 'string', description: 'Sensor MAC address', optional: true },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of sensors returned',
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
