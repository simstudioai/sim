import type {
  CrowdStrikeGetSensorAggregatesParams,
  CrowdStrikeGetSensorAggregatesResponse,
} from '@/tools/crowdstrike/types'
import type { ToolConfig } from '@/tools/types'

export const crowdstrikeGetSensorAggregatesTool: ToolConfig<
  CrowdStrikeGetSensorAggregatesParams,
  CrowdStrikeGetSensorAggregatesResponse
> = {
  id: 'crowdstrike_get_sensor_aggregates',
  name: 'CrowdStrike Get Sensor Aggregates',
  description:
    'Get documented CrowdStrike Identity Protection sensor aggregates from a JSON aggregate query body',
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
    aggregateQuery: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON aggregate query body documented by CrowdStrike for sensor aggregates',
    },
  },

  request: {
    url: '/api/tools/crowdstrike/query',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      aggregateQuery: params.aggregateQuery,
      cloud: params.cloud,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      operation: 'crowdstrike_get_sensor_aggregates',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Failed to fetch CrowdStrike sensor aggregates')
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    aggregates: {
      type: 'array',
      description: 'Aggregate result groups returned by CrowdStrike',
      items: {
        type: 'object',
        properties: {
          buckets: {
            type: 'array',
            description: 'Buckets within the aggregate result',
            items: {
              type: 'object',
              properties: {
                count: {
                  type: 'number',
                  description: 'Bucket document count',
                  optional: true,
                },
                from: {
                  type: 'number',
                  description: 'Bucket lower bound',
                  optional: true,
                },
                keyAsString: {
                  type: 'string',
                  description: 'String representation of the bucket key',
                  optional: true,
                },
                label: {
                  type: 'json',
                  description: 'Bucket label object',
                  optional: true,
                },
                stringFrom: {
                  type: 'string',
                  description: 'String lower bound',
                  optional: true,
                },
                stringTo: {
                  type: 'string',
                  description: 'String upper bound',
                  optional: true,
                },
                subAggregates: {
                  type: 'json',
                  description: 'Nested aggregate results for this bucket',
                  optional: true,
                },
                to: {
                  type: 'number',
                  description: 'Bucket upper bound',
                  optional: true,
                },
                value: {
                  type: 'number',
                  description: 'Bucket metric value',
                  optional: true,
                },
                valueAsString: {
                  type: 'string',
                  description: 'String representation of the bucket value',
                  optional: true,
                },
              },
            },
          },
          docCountErrorUpperBound: {
            type: 'number',
            description: 'Upper bound for bucket count error',
            optional: true,
          },
          name: {
            type: 'string',
            description: 'Aggregate result name',
            optional: true,
          },
          sumOtherDocCount: {
            type: 'number',
            description: 'Document count not included in the returned buckets',
            optional: true,
          },
        },
      },
    },
    count: {
      type: 'number',
      description: 'Number of aggregate result groups returned',
    },
  },
}
