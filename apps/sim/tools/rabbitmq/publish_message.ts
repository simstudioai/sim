import { isRecordLike } from '@sim/utils/object'
import type {
  RabbitmqPublishMessageParams,
  RabbitmqPublishMessageResponse,
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

export const rabbitmqPublishMessageTool: ToolConfig<
  RabbitmqPublishMessageParams,
  RabbitmqPublishMessageResponse
> = {
  id: 'rabbitmq_publish_message',
  name: 'RabbitMQ Publish Message',
  description:
    'Publish a message to a RabbitMQ exchange with a routing key. Reports whether the message was routed to at least one queue.',
  version: '1.0.0',

  params: {
    ...RABBITMQ_CONNECTION_PARAMS,
    exchange: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Exchange to publish to. Leave empty to publish to the default exchange, which routes by queue name. Empty is a valid value, so this is not required.',
    },
    routingKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Routing key. When publishing to the default exchange this is the target queue name.',
    },
    payload: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message body to publish',
    },
    payloadEncoding: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'How the payload is encoded: string (default) or base64',
    },
    properties: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'AMQP basic properties as a JSON object, e.g. {"delivery_mode":2,"content_type":"application/json"}',
    },
    headers: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Message headers as a JSON object, e.g. {"source":"sim"}',
    },
  },

  request: {
    url: ({ host, vhost, exchange }) =>
      buildManagementUrl(host, ['exchanges', resolveVhost(vhost), exchange ?? '', 'publish']),
    method: 'POST',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
    body: ({
      headers: rawHeaders,
      payload,
      payloadEncoding,
      properties: rawProperties,
      routingKey,
    }) => {
      const properties = parseJsonObjectParam(rawProperties, 'properties') ?? {}
      const headers = parseJsonObjectParam(rawHeaders, 'headers')
      if (headers) {
        // Only merge onto an existing headers object. Spreading a string or array here would
        // turn it into index-keyed junk on the published message.
        const existing = properties.headers
        const base = isRecordLike(existing) ? (existing as Record<string, unknown>) : {}
        properties.headers = { ...base, ...headers }
      }

      return {
        properties,
        routing_key: routingKey,
        payload: payload,
        payload_encoding: payloadEncoding === 'base64' ? 'base64' : 'string',
      }
    },
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return {
        success: false,
        output: {
          routed: false,
          exchange: params?.exchange ?? '',
          routingKey: params?.routingKey ?? '',
        },
        error,
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        routed: data?.routed === true,
        exchange: params?.exchange ?? '',
        routingKey: params?.routingKey ?? '',
      },
    }
  },

  outputs: {
    routed: {
      type: 'boolean',
      description:
        'Whether the message was routed to at least one queue. False means no binding matched and the message was dropped.',
    },
    exchange: { type: 'string', description: 'Exchange the message was published to' },
    routingKey: { type: 'string', description: 'Routing key the message was published with' },
  },
}
