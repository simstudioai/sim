import type { RabbitmqGetMessagesParams, RabbitmqGetMessagesResponse } from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  projectMessage,
  RABBITMQ_CONNECTION_PARAMS,
  RABBITMQ_MESSAGE_OUTPUT_PROPERTIES,
  resolveVhost,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

const ACK_MODES = new Set([
  'ack_requeue_true',
  'ack_requeue_false',
  'reject_requeue_true',
  'reject_requeue_false',
])

/**
 * The broker applies no upper bound of its own to `count`, so a single call could pull an
 * unbounded number of messages of unbounded size into memory. Both dimensions are bounded here:
 * `count` caps how many messages come back, and `truncate` caps each payload broker-side so the
 * oversized bytes are never transferred at all. The truncate default matches the management UI's own.
 */
const MAX_MESSAGE_COUNT = 100
const DEFAULT_TRUNCATE_BYTES = 50_000

/**
 * Payload budget for one call. The shared tool transport rejects any response body over 10MB,
 * and `count * truncate` alone could exceed that — base64 payloads inflate a further 4/3 on top,
 * before JSON escaping. Keeping the combined payload under this budget means a large `truncate`
 * degrades to shorter payloads rather than failing the whole retrieval at the transport cap.
 */
const MAX_TOTAL_PAYLOAD_BYTES = 4_000_000
const MAX_TRUNCATE_BYTES = 1_000_000

function resolveCount(count: number | undefined): number {
  if (typeof count !== 'number' || !Number.isFinite(count)) return 1
  return Math.min(Math.max(Math.trunc(count), 1), MAX_MESSAGE_COUNT)
}

/**
 * Resolves the per-message byte limit actually sent to the broker, bounded both per message and
 * across the whole batch so the response always fits inside the shared transport cap.
 */
function resolveTruncate(truncate: number | undefined, count: number | undefined): number {
  const requested =
    typeof truncate === 'number' && Number.isFinite(truncate)
      ? Math.max(Math.trunc(truncate), 1)
      : DEFAULT_TRUNCATE_BYTES
  const budgeted = Math.floor(MAX_TOTAL_PAYLOAD_BYTES / resolveCount(count))
  return Math.max(Math.min(requested, MAX_TRUNCATE_BYTES, budgeted), 1)
}

export const rabbitmqGetMessagesTool: ToolConfig<
  RabbitmqGetMessagesParams,
  RabbitmqGetMessagesResponse
> = {
  id: 'rabbitmq_get_messages',
  name: 'RabbitMQ Get Messages',
  description:
    'Retrieve messages from a RabbitMQ queue. Defaults to requeueing the messages so they stay available to real consumers.',
  version: '1.0.0',

  params: {
    ...RABBITMQ_CONNECTION_PARAMS,
    queue: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Queue to read messages from',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: `Maximum number of messages to retrieve, from 1 to ${MAX_MESSAGE_COUNT}. Defaults to 1`,
    },
    ackmode: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'How retrieved messages are handled: ack_requeue_true (default, leaves messages in the queue), ack_requeue_false (removes them), reject_requeue_true, or reject_requeue_false',
    },
    encoding: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'auto (default) returns readable text where possible, base64 always returns base64',
    },
    truncate: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: `Truncate payloads longer than this many bytes. Defaults to ${DEFAULT_TRUNCATE_BYTES} and is capped at ${MAX_TRUNCATE_BYTES}, and lowered further when a large count would push the response past the transport limit. Each message reports whether it was truncated`,
    },
  },

  request: {
    url: ({ host, vhost, queue }) =>
      buildManagementUrl(host, ['queues', resolveVhost(vhost), queue, 'get']),
    method: 'POST',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
    body: ({ ackmode, count, encoding, truncate }) => ({
      count: resolveCount(count),
      ackmode: ACK_MODES.has(ackmode ?? '') ? ackmode : 'ack_requeue_true',
      encoding: encoding === 'base64' ? 'base64' : 'auto',
      truncate: resolveTruncate(truncate, count),
    }),
  },

  transformResponse: async (response, params) => {
    const queueName = params?.queue ?? ''

    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return { success: false, output: { queueName, count: 0, messages: [] }, error }
    }

    const data = await response.json()
    const truncateLimit = resolveTruncate(params?.truncate, params?.count)
    const messages = Array.isArray(data)
      ? data.map((message) => projectMessage(message, truncateLimit))
      : []

    return {
      success: true,
      output: { queueName, count: messages.length, messages },
    }
  },

  outputs: {
    queueName: { type: 'string', description: 'Queue the messages were read from' },
    count: { type: 'number', description: 'Number of messages retrieved' },
    messages: {
      type: 'array',
      description: 'Retrieved messages, empty when the queue holds nothing',
      items: { type: 'object', properties: RABBITMQ_MESSAGE_OUTPUT_PROPERTIES },
    },
  },
}
