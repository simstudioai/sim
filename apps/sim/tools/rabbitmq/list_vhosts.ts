import type { RabbitmqListVhostsParams, RabbitmqListVhostsResponse } from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  projectVhost,
  RABBITMQ_CONNECTION_PARAMS,
  RABBITMQ_VHOST_OUTPUT_PROPERTIES,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

export const rabbitmqListVhostsTool: ToolConfig<
  RabbitmqListVhostsParams,
  RabbitmqListVhostsResponse
> = {
  id: 'rabbitmq_list_vhosts',
  name: 'RabbitMQ List Virtual Hosts',
  description:
    'List the virtual hosts on the broker with their message totals, so you can discover which scopes exist.',
  version: '1.0.0',

  params: { ...RABBITMQ_CONNECTION_PARAMS },

  request: {
    /**
     * Deliberately sent without pagination parameters: unlike the other list endpoints, this one
     * responds with HTTP 500 when `page`/`page_size` are supplied.
     */
    url: ({ host }) => buildManagementUrl(host, ['vhosts']),
    method: 'GET',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return { success: false, output: { vhosts: [], count: 0 }, error }
    }

    const data = await response.json()
    const vhosts = Array.isArray(data) ? data.map(projectVhost) : []

    return { success: true, output: { vhosts, count: vhosts.length } }
  },

  outputs: {
    vhosts: {
      type: 'array',
      description: 'Virtual hosts the authenticated user can see',
      items: { type: 'object', properties: RABBITMQ_VHOST_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of virtual hosts returned' },
  },
}
