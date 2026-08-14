import type { RabbitmqDeleteQueueParams, RabbitmqDeleteQueueResponse } from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  RABBITMQ_CONNECTION_PARAMS,
  resolveVhost,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

export const rabbitmqDeleteQueueTool: ToolConfig<
  RabbitmqDeleteQueueParams,
  RabbitmqDeleteQueueResponse
> = {
  id: 'rabbitmq_delete_queue',
  name: 'RabbitMQ Delete Queue',
  description:
    'Delete a RabbitMQ queue and every message still in it. Can be guarded so the delete only happens when the queue is unused or empty.',
  version: '1.0.0',

  params: {
    ...RABBITMQ_CONNECTION_PARAMS,
    queue: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the queue to delete',
    },
    ifUnused: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Only delete the queue when it has no consumers',
    },
    ifEmpty: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Only delete the queue when it holds no messages',
    },
  },

  request: {
    url: ({ host, vhost, ifEmpty, ifUnused, queue }) =>
      buildManagementUrl(host, ['queues', resolveVhost(vhost), queue], {
        'if-unused': ifUnused ? 'true' : undefined,
        'if-empty': ifEmpty ? 'true' : undefined,
      }),
    method: 'DELETE',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
  },

  transformResponse: async (response, params) => {
    const queueName = params?.queue ?? ''
    const vhost = params ? resolveVhost(params.vhost) : ''

    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return { success: false, output: { queueName, vhost, deleted: false }, error }
    }

    return { success: true, output: { queueName, vhost, deleted: true } }
  },

  outputs: {
    queueName: { type: 'string', description: 'Name of the deleted queue' },
    vhost: { type: 'string', description: 'Virtual host the queue was deleted from' },
    deleted: { type: 'boolean', description: 'Whether the queue was deleted' },
  },
}
