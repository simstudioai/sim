import type {
  RabbitmqDeleteExchangeParams,
  RabbitmqDeleteExchangeResponse,
} from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  RABBITMQ_CONNECTION_PARAMS,
  resolveVhost,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

export const rabbitmqDeleteExchangeTool: ToolConfig<
  RabbitmqDeleteExchangeParams,
  RabbitmqDeleteExchangeResponse
> = {
  id: 'rabbitmq_delete_exchange',
  name: 'RabbitMQ Delete Exchange',
  description:
    'Delete a RabbitMQ exchange and every binding attached to it. Publishers targeting it will fail afterwards.',
  version: '1.0.0',

  params: {
    ...RABBITMQ_CONNECTION_PARAMS,
    exchange: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the exchange to delete',
    },
    ifUnused: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Only delete the exchange when nothing is bound to it',
    },
  },

  request: {
    url: ({ host, vhost, exchange, ifUnused }) =>
      buildManagementUrl(host, ['exchanges', resolveVhost(vhost), exchange], {
        'if-unused': ifUnused ? 'true' : undefined,
      }),
    method: 'DELETE',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
  },

  transformResponse: async (response, params) => {
    const exchangeName = params?.exchange ?? ''
    const vhost = params ? resolveVhost(params.vhost) : ''

    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return { success: false, output: { exchangeName, vhost, deleted: false }, error }
    }

    return { success: true, output: { exchangeName, vhost, deleted: true } }
  },

  outputs: {
    exchangeName: { type: 'string', description: 'Name of the deleted exchange' },
    vhost: { type: 'string', description: 'Virtual host the exchange was deleted from' },
    deleted: { type: 'boolean', description: 'Whether the exchange was deleted' },
  },
}
