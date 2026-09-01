import type {
  RabbitmqDeletePolicyParams,
  RabbitmqDeletePolicyResponse,
} from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  RABBITMQ_CONNECTION_PARAMS,
  resolveVhost,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

export const rabbitmqDeletePolicyTool: ToolConfig<
  RabbitmqDeletePolicyParams,
  RabbitmqDeletePolicyResponse
> = {
  id: 'rabbitmq_delete_policy',
  name: 'RabbitMQ Delete Policy',
  description:
    'Delete a RabbitMQ policy. Every queue and exchange it matched immediately loses the settings it applied.',
  version: '1.0.0',

  params: {
    ...RABBITMQ_CONNECTION_PARAMS,
    policyName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the policy to delete',
    },
  },

  request: {
    url: ({ host, vhost, policyName }) =>
      buildManagementUrl(host, ['policies', resolveVhost(vhost), policyName]),
    method: 'DELETE',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
  },

  transformResponse: async (response, params) => {
    const policyName = params?.policyName ?? ''
    const vhost = params ? resolveVhost(params.vhost) : ''

    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return { success: false, output: { policyName, vhost, deleted: false }, error }
    }

    return { success: true, output: { policyName, vhost, deleted: true } }
  },

  outputs: {
    policyName: { type: 'string', description: 'Name of the deleted policy' },
    vhost: { type: 'string', description: 'Virtual host the policy applied in' },
    deleted: { type: 'boolean', description: 'Whether the policy was deleted' },
  },
}
