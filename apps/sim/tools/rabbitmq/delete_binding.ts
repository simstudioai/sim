import type {
  RabbitmqDeleteBindingParams,
  RabbitmqDeleteBindingResponse,
} from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  RABBITMQ_CONNECTION_PARAMS,
  resolveVhost,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

export const rabbitmqDeleteBindingTool: ToolConfig<
  RabbitmqDeleteBindingParams,
  RabbitmqDeleteBindingResponse
> = {
  id: 'rabbitmq_delete_binding',
  name: 'RabbitMQ Delete Binding',
  description:
    'Remove a binding so an exchange stops routing its matching messages to that destination.',
  version: '1.0.0',

  params: {
    ...RABBITMQ_CONNECTION_PARAMS,
    exchange: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source exchange the binding reads from',
    },
    destination: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination queue or exchange the binding routes to',
    },
    destinationType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the destination is a queue (default) or an exchange',
    },
    propertiesKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Broker identifier for the binding, taken from List Bindings or Create Binding. It is the routing key for a simple binding, ~ for an empty routing key, and a hashed value when the binding has arguments',
    },
  },

  request: {
    url: ({ host, vhost, destination, destinationType, exchange, propertiesKey }) =>
      buildManagementUrl(host, [
        'bindings',
        resolveVhost(vhost),
        'e',
        exchange,
        destinationType === 'exchange' ? 'e' : 'q',
        destination,
        propertiesKey,
      ]),
    method: 'DELETE',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
  },

  transformResponse: async (response, params) => {
    const exchange = params?.exchange ?? ''
    const destination = params?.destination ?? ''
    const propertiesKey = params?.propertiesKey ?? ''

    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return {
        success: false,
        output: { exchange, destination, propertiesKey, deleted: false },
        error,
      }
    }

    return { success: true, output: { exchange, destination, propertiesKey, deleted: true } }
  },

  outputs: {
    exchange: { type: 'string', description: 'Source exchange the binding read from' },
    destination: { type: 'string', description: 'Destination the binding routed to' },
    propertiesKey: { type: 'string', description: 'Broker identifier of the deleted binding' },
    deleted: { type: 'boolean', description: 'Whether the binding was deleted' },
  },
}
