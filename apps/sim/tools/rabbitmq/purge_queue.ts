import type { RabbitmqPurgeQueueParams, RabbitmqPurgeQueueResponse } from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  RABBITMQ_CONNECTION_PARAMS,
  resolveVhost,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

export const rabbitmqPurgeQueueTool: ToolConfig<
  RabbitmqPurgeQueueParams,
  RabbitmqPurgeQueueResponse
> = {
  id: 'rabbitmq_purge_queue',
  name: 'RabbitMQ Purge Queue',
  description:
    'Discard every ready message in a RabbitMQ queue while leaving the queue itself in place.',
  version: '1.0.0',

  params: {
    ...RABBITMQ_CONNECTION_PARAMS,
    queue: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the queue to purge',
    },
  },

  request: {
    url: ({ host, vhost, queue }) =>
      buildManagementUrl(host, ['queues', resolveVhost(vhost), queue, 'contents']),
    method: 'DELETE',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
  },

  transformResponse: async (response, params) => {
    const queueName = params?.queue ?? ''
    const vhost = params ? resolveVhost(params.vhost) : ''

    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return { success: false, output: { queueName, vhost, purged: false }, error }
    }

    return { success: true, output: { queueName, vhost, purged: true } }
  },

  outputs: {
    queueName: { type: 'string', description: 'Name of the purged queue' },
    vhost: { type: 'string', description: 'Virtual host the queue belongs to' },
    purged: { type: 'boolean', description: 'Whether the queue was purged' },
  },
}
