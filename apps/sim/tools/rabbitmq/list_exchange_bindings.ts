import type {
  RabbitmqListExchangeBindingsParams,
  RabbitmqListExchangeBindingsResponse,
} from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  projectBinding,
  RABBITMQ_BINDING_OUTPUT_PROPERTIES,
  RABBITMQ_CONNECTION_PARAMS,
  resolveVhost,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

export const rabbitmqListExchangeBindingsTool: ToolConfig<
  RabbitmqListExchangeBindingsParams,
  RabbitmqListExchangeBindingsResponse
> = {
  id: 'rabbitmq_list_exchange_bindings',
  name: 'RabbitMQ List Exchange Bindings',
  description:
    'List everything an exchange routes to, so you can see which routing keys reach which queues.',
  version: '1.0.0',

  params: {
    ...RABBITMQ_CONNECTION_PARAMS,
    exchange: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Exchange whose outgoing bindings should be listed. Leave empty for the default exchange, which is a valid value, so this is not required',
    },
  },

  request: {
    url: ({ host, vhost, exchange }) =>
      buildManagementUrl(host, [
        'exchanges',
        resolveVhost(vhost),
        exchange ?? '',
        'bindings',
        'source',
      ]),
    method: 'GET',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
  },

  transformResponse: async (response, params) => {
    const exchangeName = params?.exchange ?? ''

    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return { success: false, output: { exchangeName, bindings: [], count: 0 }, error }
    }

    const data = await response.json()
    const bindings = Array.isArray(data) ? data.map(projectBinding) : []

    return { success: true, output: { exchangeName, bindings, count: bindings.length } }
  },

  outputs: {
    exchangeName: { type: 'string', description: 'Exchange the bindings originate from' },
    bindings: {
      type: 'array',
      description:
        'Bindings routing out of the exchange. An empty list means nothing it publishes can be delivered',
      items: { type: 'object', properties: RABBITMQ_BINDING_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of bindings returned' },
  },
}
