import { toRecord } from '@sim/utils/object'
import type { RabbitmqGetOverviewParams, RabbitmqGetOverviewResponse } from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  RABBITMQ_CONNECTION_PARAMS,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

const EMPTY_OVERVIEW = {
  rabbitmqVersion: null,
  productName: null,
  productVersion: null,
  erlangVersion: null,
  clusterName: null,
  node: null,
  objectTotals: {},
  queueTotals: {},
  messageStats: {},
} as const

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export const rabbitmqGetOverviewTool: ToolConfig<
  RabbitmqGetOverviewParams,
  RabbitmqGetOverviewResponse
> = {
  id: 'rabbitmq_get_overview',
  name: 'RabbitMQ Get Overview',
  description:
    'Read broker-wide RabbitMQ status: version, cluster name, object totals, queue depth totals, and message rates.',
  version: '1.0.0',

  params: { ...RABBITMQ_CONNECTION_PARAMS },

  request: {
    url: ({ host }) => buildManagementUrl(host, ['overview']),
    method: 'GET',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return { success: false, output: { ...EMPTY_OVERVIEW }, error }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        rabbitmqVersion: asStringOrNull(data?.rabbitmq_version),
        productName: asStringOrNull(data?.product_name),
        productVersion: asStringOrNull(data?.product_version),
        erlangVersion: asStringOrNull(data?.erlang_version),
        clusterName: asStringOrNull(data?.cluster_name),
        node: asStringOrNull(data?.node),
        objectTotals: toRecord(data?.object_totals),
        queueTotals: toRecord(data?.queue_totals),
        messageStats: toRecord(data?.message_stats),
      },
    }
  },

  outputs: {
    rabbitmqVersion: { type: 'string', description: 'RabbitMQ version running on the node' },
    productName: { type: 'string', description: 'Broker product name' },
    productVersion: { type: 'string', description: 'Broker product version' },
    erlangVersion: { type: 'string', description: 'Erlang runtime version' },
    clusterName: { type: 'string', description: 'Name of the cluster' },
    node: { type: 'string', description: 'Node that served the request' },
    objectTotals: {
      type: 'object',
      description: 'Counts of brokers objects',
      properties: {
        connections: { type: 'number', description: 'Open connections' },
        channels: { type: 'number', description: 'Open channels' },
        exchanges: { type: 'number', description: 'Declared exchanges' },
        queues: { type: 'number', description: 'Declared queues' },
        consumers: { type: 'number', description: 'Registered consumers' },
      },
    },
    queueTotals: {
      type: 'object',
      description: 'Aggregate queue depth across the broker',
      properties: {
        messages: { type: 'number', description: 'Total messages across all queues' },
        messages_ready: { type: 'number', description: 'Messages ready for delivery' },
        messages_unacknowledged: {
          type: 'number',
          description: 'Delivered but unacknowledged messages',
        },
      },
    },
    messageStats: {
      type: 'json',
      description: 'Broker-wide message counters and rates, e.g. publish and confirm totals',
    },
  },
}
