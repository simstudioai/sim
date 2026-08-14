import type { RabbitmqGetExchangeParams, RabbitmqGetExchangeResponse } from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  projectExchange,
  RABBITMQ_CONNECTION_PARAMS,
  RABBITMQ_EXCHANGE_OUTPUT_PROPERTIES,
  resolveVhost,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

export const rabbitmqGetExchangeTool: ToolConfig<
  RabbitmqGetExchangeParams,
  RabbitmqGetExchangeResponse
> = {
  id: 'rabbitmq_get_exchange',
  name: 'RabbitMQ Get Exchange',
  description: 'Read a single RabbitMQ exchange and the settings it was declared with.',
  version: '1.0.0',

  params: {
    ...RABBITMQ_CONNECTION_PARAMS,
    exchange: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Exchange name to read. Leave empty for the default exchange, which is a valid value, so this is not required',
    },
  },

  request: {
    url: ({ host, vhost, exchange }) =>
      buildManagementUrl(host, ['exchanges', resolveVhost(vhost), exchange ?? '']),
    method: 'GET',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return { success: false, output: { exchange: projectExchange(null) }, error }
    }

    const data = await response.json()

    return { success: true, output: { exchange: projectExchange(data) } }
  },

  outputs: {
    exchange: {
      type: 'object',
      description: 'The requested exchange',
      properties: RABBITMQ_EXCHANGE_OUTPUT_PROPERTIES,
    },
  },
}
