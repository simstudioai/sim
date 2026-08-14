import type {
  RabbitmqListPoliciesParams,
  RabbitmqListPoliciesResponse,
} from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  projectPolicy,
  RABBITMQ_CONNECTION_PARAMS,
  RABBITMQ_POLICY_OUTPUT_PROPERTIES,
  resolveVhost,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

export const rabbitmqListPoliciesTool: ToolConfig<
  RabbitmqListPoliciesParams,
  RabbitmqListPoliciesResponse
> = {
  id: 'rabbitmq_list_policies',
  name: 'RabbitMQ List Policies',
  description:
    'List the policies in a virtual host. Policies are how dead-lettering, TTLs, and length limits get applied to matching queues and exchanges.',
  version: '1.0.0',

  params: { ...RABBITMQ_CONNECTION_PARAMS },

  request: {
    url: ({ host, vhost }) => buildManagementUrl(host, ['policies', resolveVhost(vhost)]),
    method: 'GET',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return { success: false, output: { policies: [], count: 0 }, error }
    }

    const data = await response.json()
    const policies = Array.isArray(data) ? data.map(projectPolicy) : []

    return { success: true, output: { policies, count: policies.length } }
  },

  outputs: {
    policies: {
      type: 'array',
      description: 'Policies defined in the virtual host',
      items: { type: 'object', properties: RABBITMQ_POLICY_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of policies returned' },
  },
}
