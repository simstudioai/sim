import type { RabbitmqCreateQueueParams, RabbitmqCreateQueueResponse } from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  parseJsonObjectParam,
  RABBITMQ_CONNECTION_PARAMS,
  resolveVhost,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

export const rabbitmqCreateQueueTool: ToolConfig<
  RabbitmqCreateQueueParams,
  RabbitmqCreateQueueResponse
> = {
  id: 'rabbitmq_create_queue',
  name: 'RabbitMQ Create Queue',
  description:
    'Declare a RabbitMQ queue. Declaring a queue that already exists with the same settings succeeds without changing it.',
  version: '1.0.0',

  params: {
    ...RABBITMQ_CONNECTION_PARAMS,
    queue: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the queue to declare',
    },
    durable: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether the queue survives a broker restart. Defaults to true',
    },
    autoDelete: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Delete the queue when its last consumer disconnects. Defaults to false',
    },
    arguments: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Queue arguments as a JSON object, e.g. {"x-queue-type":"quorum","x-message-ttl":60000}',
    },
  },

  request: {
    url: ({ host, vhost, queue }) =>
      buildManagementUrl(host, ['queues', resolveVhost(vhost), queue]),
    method: 'PUT',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
    body: ({ arguments: queueArguments, autoDelete, durable }) => ({
      durable: durable !== false,
      auto_delete: autoDelete === true,
      arguments: parseJsonObjectParam(queueArguments, 'arguments') ?? {},
    }),
  },

  transformResponse: async (response, params) => {
    const queueName = params?.queue ?? ''
    const vhost = params ? resolveVhost(params.vhost) : ''

    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return { success: false, output: { queueName, vhost, created: false }, error }
    }

    return { success: true, output: { queueName, vhost, created: true } }
  },

  outputs: {
    queueName: { type: 'string', description: 'Name of the declared queue' },
    vhost: { type: 'string', description: 'Virtual host the queue was declared in' },
    created: { type: 'boolean', description: 'Whether the declaration succeeded' },
  },
}
