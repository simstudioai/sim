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
 * unbounded number of messages into memory, and the shared tool transport rejects any response
 * body over 10MB before a tool ever sees it. Both dimensions are bounded here.
 */
const MAX_MESSAGE_COUNT = 50
const DEFAULT_TRUNCATE_BYTES = 50_000
const MIN_TRUNCATE_BYTES = 1_024
const MAX_TRUNCATE_BYTES = 1_000_000

/**
 * Budget for one retrieval, kept under the transport's 10MB cap with room for the JSON envelope.
 */
const RESPONSE_BUDGET_BYTES = 8_000_000

/**
 * Per-message allowance for AMQP properties and headers. `truncate` bounds the payload only —
 * the broker returns properties in full — so the budget has to reserve space for them rather
 * than assume they are small. This figure is RabbitMQ's default `frame_max`, which bounds the
 * content header frame carrying a message's properties, so any message published by a standard
 * AMQP client fits inside it.
 *
 * The one case this cannot cover is a message published through the management HTTP API itself,
 * which bypasses `frame_max` and accepts properties up to that API's ~10MB request-body limit.
 * Retrieving several of those can still exceed the transport cap and surfaces as a response-size
 * error; the remedy is a lower `count`.
 */
const PER_MESSAGE_METADATA_RESERVE_BYTES = 131_072

/** base64 payloads inflate 4/3 on the wire before JSON escaping. */
const BASE64_INFLATION = 4 / 3

function resolveCount(count: number | undefined): number {
  if (typeof count !== 'number' || !Number.isFinite(count)) return 1
  return Math.min(Math.max(Math.trunc(count), 1), MAX_MESSAGE_COUNT)
}

/**
 * Resolves the per-message payload limit sent to the broker. The whole batch — payloads plus the
 * reserved metadata allowance for every message — is held inside {@link RESPONSE_BUDGET_BYTES},
 * so asking for a large `truncate` alongside a large `count` yields shorter payloads rather than
 * a retrieval that fails at the transport cap.
 */
function resolveTruncate(truncate: number | undefined, count: number | undefined): number {
  const messages = resolveCount(count)
  const requested =
    typeof truncate === 'number' && Number.isFinite(truncate)
      ? Math.max(Math.trunc(truncate), 1)
      : DEFAULT_TRUNCATE_BYTES

  const payloadBudget = RESPONSE_BUDGET_BYTES - messages * PER_MESSAGE_METADATA_RESERVE_BYTES
  const perMessageBudget = Math.floor(payloadBudget / messages / BASE64_INFLATION)

  return Math.max(Math.min(requested, MAX_TRUNCATE_BYTES, perMessageBudget), MIN_TRUNCATE_BYTES)
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
      description: `Truncate payloads longer than this many bytes. Defaults to ${DEFAULT_TRUNCATE_BYTES}, capped at ${MAX_TRUNCATE_BYTES}, and lowered further at high counts so the whole batch stays inside the response limit. Each message reports whether it was truncated`,
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
