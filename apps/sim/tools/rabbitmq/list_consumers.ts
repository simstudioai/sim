import type {
  RabbitmqListConsumersParams,
  RabbitmqListConsumersResponse,
} from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  projectConsumer,
  RABBITMQ_CONNECTION_PARAMS,
  RABBITMQ_CONSUMER_COLUMNS,
  RABBITMQ_CONSUMER_OUTPUT_PROPERTIES,
  resolveVhost,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

export const rabbitmqListConsumersTool: ToolConfig<
  RabbitmqListConsumersParams,
  RabbitmqListConsumersResponse
> = {
  id: 'rabbitmq_list_consumers',
  name: 'RabbitMQ List Consumers',
  description:
    'List the consumers subscribed in a virtual host. An empty result for a queue with a backlog means nothing is processing it.',
  version: '1.0.0',

  params: { ...RABBITMQ_CONNECTION_PARAMS },

  request: {
    url: ({ host, vhost }) =>
      buildManagementUrl(host, ['consumers', resolveVhost(vhost)], {
        columns: RABBITMQ_CONSUMER_COLUMNS,
      }),
    method: 'GET',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return { success: false, output: { consumers: [], count: 0 }, error }
    }

    const data = await response.json()
    const consumers = Array.isArray(data) ? data.map(projectConsumer) : []

    return { success: true, output: { consumers, count: consumers.length } }
  },

  outputs: {
    consumers: {
      type: 'array',
      description: 'Consumers currently subscribed in the virtual host',
      items: { type: 'object', properties: RABBITMQ_CONSUMER_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of consumers returned' },
  },
}
