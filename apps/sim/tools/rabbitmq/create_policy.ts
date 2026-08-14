import type {
  RabbitmqCreatePolicyParams,
  RabbitmqCreatePolicyResponse,
} from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  parseJsonObjectParam,
  RABBITMQ_CONNECTION_PARAMS,
  resolveVhost,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

const APPLY_TO = new Set([
  'all',
  'queues',
  'classic_queues',
  'quorum_queues',
  'streams',
  'exchanges',
])

export const rabbitmqCreatePolicyTool: ToolConfig<
  RabbitmqCreatePolicyParams,
  RabbitmqCreatePolicyResponse
> = {
  id: 'rabbitmq_create_policy',
  name: 'RabbitMQ Create Policy',
  description:
    'Create or replace a RabbitMQ policy, applying settings such as dead-lettering, TTLs, or length limits to every queue or exchange whose name matches a pattern.',
  version: '1.0.0',

  params: {
    ...RABBITMQ_CONNECTION_PARAMS,
    policyName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the policy. Reusing an existing name replaces that policy',
    },
    pattern: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Regular expression matched against queue or exchange names, e.g. ^orders\\. to match every name starting with orders.',
    },
    definition: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Settings to apply, as a JSON object, e.g. {"dead-letter-exchange":"dlx","message-ttl":86400000,"max-length":10000}',
    },
    priority: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Priority, defaulting to 0. When several policies match a resource only the highest-priority one applies — they do not merge',
    },
    applyTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'What the policy applies to: queues (default), classic_queues, quorum_queues, streams, exchanges, or all',
    },
  },

  request: {
    url: (params) =>
      buildManagementUrl(params, ['policies', resolveVhost(params), params.policyName]),
    method: 'PUT',
    headers: (params) => buildAuthHeaders(params),
    body: (params) => ({
      pattern: params.pattern,
      definition: parseJsonObjectParam(params.definition, 'definition') ?? {},
      priority: params.priority ?? 0,
      'apply-to': APPLY_TO.has(params.applyTo ?? '') ? params.applyTo : 'queues',
    }),
  },

  transformResponse: async (response, params) => {
    const policyName = params?.policyName ?? ''
    const vhost = params ? resolveVhost(params) : ''

    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return { success: false, output: { policyName, vhost, created: false }, error }
    }

    return { success: true, output: { policyName, vhost, created: true } }
  },

  outputs: {
    policyName: { type: 'string', description: 'Name of the created policy' },
    vhost: { type: 'string', description: 'Virtual host the policy applies in' },
    created: { type: 'boolean', description: 'Whether the policy was created or replaced' },
  },
}
