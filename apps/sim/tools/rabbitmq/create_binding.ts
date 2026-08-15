import type {
  RabbitmqCreateBindingParams,
  RabbitmqCreateBindingResponse,
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

/**
 * The broker returns the new binding as a `location` header shaped `destination/properties_key`,
 * with the properties key percent-encoded. The properties key never contains a literal slash,
 * so the final segment is the key.
 */
function extractPropertiesKey(location: string | null): string | null {
  if (!location) return null

  const segment = location.slice(location.lastIndexOf('/') + 1)
  if (!segment) return null

  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export const rabbitmqCreateBindingTool: ToolConfig<
  RabbitmqCreateBindingParams,
  RabbitmqCreateBindingResponse
> = {
  id: 'rabbitmq_create_binding',
  name: 'RabbitMQ Create Binding',
  description:
    'Bind a queue or another exchange to a RabbitMQ exchange so messages matching a routing key are routed to it.',
  version: '1.0.0',

  params: {
    ...RABBITMQ_CONNECTION_PARAMS,
    exchange: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source exchange to bind from',
    },
    queue: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination queue, or destination exchange when binding exchange to exchange',
    },
    destinationType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the destination is a queue (default) or an exchange. Exchange-to-exchange bindings chain routing between exchanges',
    },
    routingKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Routing key the binding matches. Topic exchanges accept wildcards such as orders.*',
    },
    arguments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Binding arguments as a JSON object. Headers exchanges match on these, e.g. {"x-match":"all","type":"invoice"}',
    },
  },

  request: {
    url: ({ host, vhost, destinationType, exchange, queue }) =>
      buildManagementUrl(host, [
        'bindings',
        resolveVhost(vhost),
        'e',
        exchange,
        destinationType === 'exchange' ? 'e' : 'q',
        queue,
      ]),
    method: 'POST',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
    body: ({ arguments: bindingArguments, routingKey }) => ({
      routing_key: routingKey ?? '',
      arguments: parseJsonObjectParam(bindingArguments, 'arguments') ?? {},
    }),
  },

  transformResponse: async (response, params) => {
    const exchange = params?.exchange ?? ''
    const queueName = params?.queue ?? ''
    const routingKey = params?.routingKey ?? ''

    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return {
        success: false,
        output: { exchange, queueName, routingKey, propertiesKey: null, created: false },
        error,
      }
    }

    return {
      success: true,
      output: {
        exchange,
        queueName,
        routingKey,
        propertiesKey: extractPropertiesKey(response.headers.get('location')),
        created: true,
      },
    }
  },

  outputs: {
    exchange: { type: 'string', description: 'Source exchange the binding reads from' },
    queueName: { type: 'string', description: 'Destination queue the binding routes into' },
    routingKey: { type: 'string', description: 'Routing key the binding matches' },
    propertiesKey: {
      type: 'string',
      description: 'Broker identifier addressing the new binding',
      optional: true,
    },
    created: { type: 'boolean', description: 'Whether the binding was created' },
  },
}
