import type {
  RabbitmqCreateExchangeParams,
  RabbitmqCreateExchangeResponse,
} from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  parseJsonObjectParam,
  RABBITMQ_CONNECTION_PARAMS,
  resolveVhost,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

const EXCHANGE_TYPES = new Set(['direct', 'fanout', 'topic', 'headers'])

export const rabbitmqCreateExchangeTool: ToolConfig<
  RabbitmqCreateExchangeParams,
  RabbitmqCreateExchangeResponse
> = {
  id: 'rabbitmq_create_exchange',
  name: 'RabbitMQ Create Exchange',
  description:
    'Declare a RabbitMQ exchange. Declaring an exchange that already exists with the same settings succeeds without changing it.',
  version: '1.0.0',

  params: {
    ...RABBITMQ_CONNECTION_PARAMS,
    exchange: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the exchange to declare',
    },
    exchangeType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Routing behaviour: direct (exact routing key, default), topic (wildcard patterns), fanout (every bound queue), or headers (match on binding arguments)',
    },
    durable: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether the exchange survives a broker restart. Defaults to true',
    },
    autoDelete: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Delete the exchange once its last binding is removed. Defaults to false',
    },
    internal: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'Internal exchanges cannot be published to directly, only bound from another exchange. Defaults to false',
    },
    arguments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Exchange arguments as a JSON object, e.g. {"alternate-exchange":"unrouted"} to capture messages that match no binding',
    },
  },

  request: {
    url: (params) =>
      buildManagementUrl(params, ['exchanges', resolveVhost(params), params.exchange]),
    method: 'PUT',
    headers: (params) => buildAuthHeaders(params),
    body: (params) => ({
      type: EXCHANGE_TYPES.has(params.exchangeType ?? '') ? params.exchangeType : 'direct',
      durable: params.durable !== false,
      auto_delete: params.autoDelete === true,
      internal: params.internal === true,
      arguments: parseJsonObjectParam(params.arguments, 'arguments') ?? {},
    }),
  },

  transformResponse: async (response, params) => {
    const exchangeName = params?.exchange ?? ''
    const vhost = params ? resolveVhost(params) : ''

    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return { success: false, output: { exchangeName, vhost, created: false }, error }
    }

    return { success: true, output: { exchangeName, vhost, created: true } }
  },

  outputs: {
    exchangeName: { type: 'string', description: 'Name of the declared exchange' },
    vhost: { type: 'string', description: 'Virtual host the exchange was declared in' },
    created: { type: 'boolean', description: 'Whether the declaration succeeded' },
  },
}
