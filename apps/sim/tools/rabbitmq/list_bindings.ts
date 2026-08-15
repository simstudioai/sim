import type {
  RabbitmqListBindingsParams,
  RabbitmqListBindingsResponse,
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

export const rabbitmqListBindingsTool: ToolConfig<
  RabbitmqListBindingsParams,
  RabbitmqListBindingsResponse
> = {
  id: 'rabbitmq_list_bindings',
  name: 'RabbitMQ List Bindings',
  description:
    'List the bindings that route messages into a RabbitMQ queue, including the implicit default-exchange binding.',
  version: '1.0.0',

  params: {
    ...RABBITMQ_CONNECTION_PARAMS,
    queue: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Queue whose bindings should be listed',
    },
  },

  request: {
    url: ({ host, vhost, queue }) =>
      buildManagementUrl(host, ['queues', resolveVhost(vhost), queue, 'bindings']),
    method: 'GET',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
  },

  transformResponse: async (response, params) => {
    const queueName = params?.queue ?? ''

    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return { success: false, output: { queueName, bindings: [], count: 0 }, error }
    }

    const data = await response.json()
    const bindings = Array.isArray(data) ? data.map(projectBinding) : []

    return { success: true, output: { queueName, bindings, count: bindings.length } }
  },

  outputs: {
    queueName: { type: 'string', description: 'Queue the bindings route into' },
    bindings: {
      type: 'array',
      description:
        'Bindings targeting the queue. The entry with an empty source is the implicit default-exchange binding',
      items: { type: 'object', properties: RABBITMQ_BINDING_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of bindings returned' },
  },
}
