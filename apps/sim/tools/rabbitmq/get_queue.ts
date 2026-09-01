import type { RabbitmqGetQueueParams, RabbitmqGetQueueResponse } from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  projectQueue,
  RABBITMQ_CONNECTION_PARAMS,
  RABBITMQ_QUEUE_OUTPUT_PROPERTIES,
  resolveVhost,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

export const rabbitmqGetQueueTool: ToolConfig<RabbitmqGetQueueParams, RabbitmqGetQueueResponse> = {
  id: 'rabbitmq_get_queue',
  name: 'RabbitMQ Get Queue',
  description:
    'Read a single RabbitMQ queue, including its depth, consumer count, and declaration settings.',
  version: '1.0.0',

  params: {
    ...RABBITMQ_CONNECTION_PARAMS,
    queue: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Queue name to read',
    },
  },

  request: {
    url: ({ host, vhost, queue }) =>
      buildManagementUrl(host, ['queues', resolveVhost(vhost), queue]),
    method: 'GET',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return { success: false, output: { queue: projectQueue(null) }, error }
    }

    const data = await response.json()

    return { success: true, output: { queue: projectQueue(data) } }
  },

  outputs: {
    queue: {
      type: 'object',
      description: 'The requested queue',
      properties: RABBITMQ_QUEUE_OUTPUT_PROPERTIES,
    },
  },
}
