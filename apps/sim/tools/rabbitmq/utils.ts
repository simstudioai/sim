import { isLoopbackIp } from '@sim/security/ssrf'
import { toRecord } from '@sim/utils/object'
import type {
  RabbitmqBinding,
  RabbitmqChannel,
  RabbitmqConnection,
  RabbitmqConsumer,
  RabbitmqExchange,
  RabbitmqMessage,
  RabbitmqNode,
  RabbitmqPolicy,
  RabbitmqQueue,
  RabbitmqVhost,
} from '@/tools/rabbitmq/types'

/** Connection params every RabbitMQ tool declares. Spread into each tool's `params`. */
export const RABBITMQ_CONNECTION_PARAMS = {
  host: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description:
      'RabbitMQ Management API base URL, e.g. https://rabbit.example.com:15672. Must use https unless the broker is on a loopback host.',
  },
  username: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'RabbitMQ username',
  },
  password: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'RabbitMQ password',
  },
  vhost: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description: 'Virtual host to operate on. Defaults to /',
  },
} as const

/** Output shape of a projected queue. Shared by the list and get tools. */
export const RABBITMQ_QUEUE_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Queue name' },
  vhost: { type: 'string', description: 'Virtual host the queue belongs to' },
  type: { type: 'string', description: 'Queue type, e.g. classic, quorum, or stream' },
  state: { type: 'string', description: 'Queue state, e.g. running or idle' },
  durable: { type: 'boolean', description: 'Whether the queue survives a broker restart' },
  autoDelete: {
    type: 'boolean',
    description: 'Whether the queue is deleted when its last consumer disconnects',
  },
  exclusive: { type: 'boolean', description: 'Whether the queue is exclusive to one connection' },
  node: { type: 'string', description: 'Cluster node hosting the queue' },
  policy: { type: 'string', description: 'Name of the policy applied to the queue, if any' },
  arguments: { type: 'json', description: 'Queue arguments the queue was declared with' },
  messages: {
    type: 'number',
    description: 'Total messages in the queue. Null until the broker has collected statistics',
  },
  messagesReady: {
    type: 'number',
    description: 'Messages ready for delivery. Null until the broker has collected statistics',
  },
  messagesUnacknowledged: {
    type: 'number',
    description: 'Delivered but unacknowledged messages. Null until statistics are collected',
  },
  consumers: {
    type: 'number',
    description: 'Number of consumers. Null until the broker has collected statistics',
  },
  memory: {
    type: 'number',
    description: 'Memory used by the queue process in bytes. Null until statistics are collected',
  },
} as const

export const RABBITMQ_EXCHANGE_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Exchange name. Empty string for the default exchange' },
  vhost: { type: 'string', description: 'Virtual host the exchange belongs to' },
  type: { type: 'string', description: 'Exchange type: direct, fanout, topic, or headers' },
  durable: { type: 'boolean', description: 'Whether the exchange survives a broker restart' },
  autoDelete: {
    type: 'boolean',
    description: 'Whether the exchange is deleted when its last binding is removed',
  },
  internal: {
    type: 'boolean',
    description: 'Whether the exchange is internal and cannot be published to directly',
  },
  arguments: { type: 'json', description: 'Exchange arguments the exchange was declared with' },
} as const

export const RABBITMQ_BINDING_OUTPUT_PROPERTIES = {
  source: { type: 'string', description: 'Source exchange name' },
  vhost: { type: 'string', description: 'Virtual host the binding belongs to' },
  destination: { type: 'string', description: 'Destination queue or exchange name' },
  destinationType: { type: 'string', description: 'Destination kind: queue or exchange' },
  routingKey: { type: 'string', description: 'Routing key the binding matches' },
  propertiesKey: { type: 'string', description: 'Broker identifier addressing this binding' },
  arguments: { type: 'json', description: 'Binding arguments' },
} as const

export const RABBITMQ_MESSAGE_OUTPUT_PROPERTIES = {
  payload: { type: 'string', description: 'Message body' },
  payloadBytes: { type: 'number', description: 'Size of the message body in bytes' },
  payloadEncoding: { type: 'string', description: 'Payload encoding: string or base64' },
  exchange: { type: 'string', description: 'Exchange the message was published to' },
  routingKey: { type: 'string', description: 'Routing key the message was published with' },
  redelivered: { type: 'boolean', description: 'Whether the message was previously delivered' },
  messageCount: {
    type: 'number',
    description: 'Messages remaining in the queue after this one was retrieved',
  },
  truncated: {
    type: 'boolean',
    description:
      'Whether the returned payload was cut short by the truncate limit. payloadBytes reports the full size',
  },
  properties: { type: 'json', description: 'AMQP basic properties, including headers' },
} as const

/**
 * Normalizes the user-supplied management host into an origin the API paths append to.
 * Tolerates a trailing slash and a trailing `/api` so both forms of the URL people copy
 * out of the management UI work.
 */
function normalizeHost(host: string): string {
  const trimmed = host?.trim()
  if (!trimmed) {
    throw new Error('RabbitMQ host is required')
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(
      `Invalid RabbitMQ host "${trimmed}". Provide a full URL, e.g. https://rabbit.example.com:15672`
    )
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported RabbitMQ host protocol "${parsed.protocol}". Use http or https.`)
  }

  // Shared outbound validation only permits plain http to a loopback host, so a remote
  // http:// endpoint would be refused at dispatch with a generic protocol error. Reject it
  // here instead, where the message can name the field the operator has to change.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isLoopback = hostname === 'localhost' || isLoopbackIp(hostname)
  if (parsed.protocol === 'http:' && !isLoopback) {
    throw new Error(
      `RabbitMQ host "${trimmed}" must use https. Plain http is only accepted for a loopback host.`
    )
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/(api\/?)?$/, '')}`
}

/** Resolves the target virtual host, defaulting to the broker's default vhost `/`. */
export function resolveVhost(vhost: string | undefined): string {
  const trimmed = vhost?.trim()
  return trimmed ? trimmed : '/'
}

/**
 * The broker rejects a page size outside this range with HTTP 400
 * `invalid_pagination_parameters`, so clamp rather than forward an unusable value.
 */
export const RABBITMQ_MAX_PAGE_SIZE = 500

/** Clamps a user- or model-supplied page size into the range the broker accepts. */
export function clampPageSize(pageSize: number | undefined, fallback: number): number {
  if (typeof pageSize !== 'number' || !Number.isFinite(pageSize)) return fallback
  return Math.min(Math.max(Math.trunc(pageSize), 1), RABBITMQ_MAX_PAGE_SIZE)
}

/**
 * Builds a Management API URL. Path segments are encoded individually so vhost `/`
 * becomes `%2F`, which the API requires, and trimmed so a name pasted with surrounding
 * whitespace does not turn into a 404.
 */
export function buildManagementUrl(
  host: string,
  segments: string[],
  query?: Record<string, string | number | boolean | undefined>
): string {
  const path = segments.map((segment) => encodeURIComponent(segment.trim())).join('/')
  const url = `${normalizeHost(host)}/api/${path}`

  if (!query) return url

  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const queryString = search.toString()
  return queryString ? `${url}?${queryString}` : url
}

export function buildAuthHeaders(username: string, password: string): Record<string, string> {
  if (!username || !password) {
    throw new Error('RabbitMQ username and password are required')
  }

  const credentials = Buffer.from(`${username}:${password}`).toString('base64')
  return {
    Authorization: `Basic ${credentials}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Extracts a readable message from a Management API error body, which is shaped
 * `{ "error": "...", "reason": "..." }`.
 */
export async function extractErrorMessage(response: Response): Promise<string> {
  const text = await response.text()
  let detail = text.trim()

  try {
    const body = JSON.parse(text)
    const reason = typeof body?.reason === 'string' ? body.reason : ''
    const error = typeof body?.error === 'string' ? body.error : ''
    detail = [error, reason].filter(Boolean).join(': ') || detail
  } catch {
    // Non-JSON body — fall back to the raw text.
  }

  return `RabbitMQ request failed (${response.status})${detail ? `: ${detail}` : ''}`
}

/** Parses an optional JSON-object param, surfacing a field-specific message on bad input. */
export function parseJsonObjectParam(
  value: string | undefined,
  field: string
): Record<string, unknown> | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error(`${field} must be a valid JSON object`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${field} must be a JSON object`)
  }

  return parsed as Record<string, unknown>
}

interface PaginatedResult<T> {
  items: T[]
  totalCount: number | null
  page: number | null
  pageCount: number | null
}

/**
 * Normalizes a list endpoint response. The Management API returns a pagination envelope
 * when page params are supplied and a bare array otherwise.
 */
export function unwrapPaginated<T>(data: unknown): PaginatedResult<T> {
  if (Array.isArray(data)) {
    return { items: data as T[], totalCount: data.length, page: null, pageCount: null }
  }

  const envelope = data as Record<string, unknown> | null
  const items = Array.isArray(envelope?.items) ? (envelope.items as T[]) : []
  return {
    items,
    totalCount: typeof envelope?.total_count === 'number' ? envelope.total_count : null,
    page: typeof envelope?.page === 'number' ? envelope.page : null,
    pageCount: typeof envelope?.page_count === 'number' ? envelope.page_count : null,
  }
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asBooleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/**
 * Fields requested from list endpoints via the `columns` query parameter. A full queue record
 * carries per-queue statistics, consumer details, and garbage-collection blobs that this
 * integration discards, so asking for only the projected fields keeps the response small
 * instead of parsing several hundred KB per page and throwing most of it away.
 */
export const RABBITMQ_QUEUE_COLUMNS = [
  'name',
  'vhost',
  'type',
  'state',
  'durable',
  'auto_delete',
  'exclusive',
  'node',
  'policy',
  'arguments',
  'messages',
  'messages_ready',
  'messages_unacknowledged',
  'consumers',
  'memory',
].join(',')

export const RABBITMQ_EXCHANGE_COLUMNS = [
  'name',
  'vhost',
  'type',
  'durable',
  'auto_delete',
  'internal',
  'arguments',
].join(',')

/**
 * Projects a raw queue object. Message and consumer statistics are omitted by the broker
 * until it has collected stats for the queue, so they are nullable.
 */
export function projectQueue(raw: unknown): RabbitmqQueue {
  const queue = toRecord(raw)
  return {
    name: String(queue.name ?? ''),
    vhost: String(queue.vhost ?? ''),
    type: asStringOrNull(queue.type),
    state: asStringOrNull(queue.state),
    durable: asBooleanOrNull(queue.durable),
    autoDelete: asBooleanOrNull(queue.auto_delete),
    exclusive: asBooleanOrNull(queue.exclusive),
    node: asStringOrNull(queue.node),
    policy: asStringOrNull(queue.policy),
    arguments: toRecord(queue.arguments),
    messages: asNumberOrNull(queue.messages),
    messagesReady: asNumberOrNull(queue.messages_ready),
    messagesUnacknowledged: asNumberOrNull(queue.messages_unacknowledged),
    consumers: asNumberOrNull(queue.consumers),
    memory: asNumberOrNull(queue.memory),
  }
}

export function projectExchange(raw: unknown): RabbitmqExchange {
  const exchange = toRecord(raw)
  return {
    name: String(exchange.name ?? ''),
    vhost: String(exchange.vhost ?? ''),
    type: String(exchange.type ?? ''),
    durable: exchange.durable === true,
    autoDelete: exchange.auto_delete === true,
    internal: exchange.internal === true,
    arguments: toRecord(exchange.arguments),
  }
}

export function projectBinding(raw: unknown): RabbitmqBinding {
  const binding = toRecord(raw)
  return {
    source: String(binding.source ?? ''),
    vhost: String(binding.vhost ?? ''),
    destination: String(binding.destination ?? ''),
    destinationType: String(binding.destination_type ?? ''),
    routingKey: String(binding.routing_key ?? ''),
    propertiesKey: String(binding.properties_key ?? ''),
    arguments: toRecord(binding.arguments),
  }
}

/**
 * Projects a retrieved message. `payload_bytes` always reports the message's true size even
 * when the broker truncated the returned payload, so comparing it against the requested limit
 * makes truncation visible instead of silently handing back a short payload.
 */
export function projectMessage(raw: unknown, truncateLimit: number): RabbitmqMessage {
  const message = toRecord(raw)
  const payloadBytes = typeof message.payload_bytes === 'number' ? message.payload_bytes : 0
  return {
    truncated: payloadBytes > truncateLimit,
    payload: String(message.payload ?? ''),
    payloadBytes,
    payloadEncoding: String(message.payload_encoding ?? ''),
    exchange: String(message.exchange ?? ''),
    routingKey: String(message.routing_key ?? ''),
    redelivered: message.redelivered === true,
    messageCount: typeof message.message_count === 'number' ? message.message_count : 0,
    properties: toRecord(message.properties),
  }
}

export const RABBITMQ_VHOST_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Virtual host name' },
  description: { type: 'string', description: 'Virtual host description' },
  tags: { type: 'json', description: 'Tags applied to the virtual host' },
  defaultQueueType: {
    type: 'string',
    description: 'Queue type used when a declaration does not specify one',
  },
  tracing: { type: 'boolean', description: 'Whether firehose tracing is enabled' },
  messages: { type: 'number', description: 'Total messages across the virtual host' },
  messagesReady: { type: 'number', description: 'Messages ready for delivery' },
  messagesUnacknowledged: { type: 'number', description: 'Delivered but unacknowledged messages' },
  clusterState: { type: 'json', description: 'Per-node state of the virtual host' },
} as const

export const RABBITMQ_CONNECTION_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Connection name, formatted as peer -> broker' },
  user: { type: 'string', description: 'Authenticated user' },
  vhost: { type: 'string', description: 'Virtual host the connection is bound to' },
  state: { type: 'string', description: 'Connection state, e.g. running, blocked, or flow' },
  protocol: { type: 'string', description: 'Protocol and version, e.g. AMQP 0-9-1' },
  node: { type: 'string', description: 'Cluster node holding the connection' },
  channels: { type: 'number', description: 'Number of open channels on the connection' },
  peerHost: { type: 'string', description: 'Client host address' },
  peerPort: { type: 'number', description: 'Client port' },
  connectedAt: { type: 'number', description: 'Connection start time in epoch milliseconds' },
  ssl: { type: 'boolean', description: 'Whether the connection is TLS-encrypted' },
} as const

export const RABBITMQ_CHANNEL_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Channel name, including its connection and number' },
  number: { type: 'number', description: 'Channel number within its connection' },
  user: { type: 'string', description: 'Authenticated user' },
  vhost: { type: 'string', description: 'Virtual host the channel is bound to' },
  node: { type: 'string', description: 'Cluster node holding the channel' },
  state: { type: 'string', description: 'Channel state, e.g. running or flow' },
  consumerCount: { type: 'number', description: 'Consumers registered on the channel' },
  prefetchCount: { type: 'number', description: 'QoS prefetch limit, 0 when unlimited' },
  messagesUnacknowledged: {
    type: 'number',
    description: 'Messages delivered on this channel awaiting acknowledgement',
  },
  confirm: { type: 'boolean', description: 'Whether publisher confirms are enabled' },
  connectionName: { type: 'string', description: 'Name of the owning connection' },
} as const

export const RABBITMQ_CONSUMER_OUTPUT_PROPERTIES = {
  consumerTag: { type: 'string', description: 'Consumer tag identifying the subscription' },
  queue: { type: 'string', description: 'Queue the consumer reads from' },
  vhost: { type: 'string', description: 'Virtual host the queue belongs to' },
  ackRequired: {
    type: 'boolean',
    description: 'Whether the consumer must acknowledge messages explicitly',
  },
  active: {
    type: 'boolean',
    description: 'Whether the consumer is currently receiving messages',
  },
  activityStatus: {
    type: 'string',
    description: 'Why the consumer is or is not active, e.g. up or single_active',
  },
  exclusive: { type: 'boolean', description: 'Whether the consumer has exclusive queue access' },
  prefetchCount: { type: 'number', description: 'QoS prefetch limit for the consumer' },
  channelName: { type: 'string', description: 'Channel the consumer runs on' },
  connectionName: { type: 'string', description: 'Connection the consumer runs on' },
} as const

export const RABBITMQ_NODE_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Node name, e.g. rabbit@host' },
  type: { type: 'string', description: 'Node type: disc or ram' },
  running: { type: 'boolean', description: 'Whether the node is running' },
  memUsed: { type: 'number', description: 'Memory used by the node in bytes' },
  memLimit: { type: 'number', description: 'Memory high watermark in bytes' },
  memAlarm: {
    type: 'boolean',
    description: 'Whether the memory alarm has fired, which blocks publishers',
  },
  diskFree: { type: 'number', description: 'Free disk space in bytes' },
  diskFreeLimit: { type: 'number', description: 'Free disk space low watermark in bytes' },
  diskFreeAlarm: {
    type: 'boolean',
    description: 'Whether the disk alarm has fired, which blocks publishers',
  },
  fdUsed: { type: 'number', description: 'File descriptors in use' },
  fdTotal: { type: 'number', description: 'File descriptor limit' },
  procUsed: { type: 'number', description: 'Erlang processes in use' },
  procTotal: { type: 'number', description: 'Erlang process limit' },
  uptime: { type: 'number', description: 'Node uptime in milliseconds' },
  partitions: {
    type: 'json',
    description:
      'Nodes this node considers network-partitioned from it. Non-empty means split brain',
  },
  beingDrained: {
    type: 'boolean',
    description: 'Whether the node is being drained for maintenance',
  },
} as const

export const RABBITMQ_POLICY_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Policy name' },
  vhost: { type: 'string', description: 'Virtual host the policy applies in' },
  pattern: { type: 'string', description: 'Regular expression matching queue or exchange names' },
  applyTo: {
    type: 'string',
    description:
      'What the policy applies to: all, queues, classic_queues, quorum_queues, streams, or exchanges',
  },
  priority: {
    type: 'number',
    description: 'Priority. Only the highest-priority matching policy applies to a given resource',
  },
  definition: { type: 'json', description: 'Policy definition keys applied to matching resources' },
} as const

export function projectVhost(raw: unknown): RabbitmqVhost {
  const vhost = toRecord(raw)
  return {
    name: String(vhost.name ?? ''),
    description: asStringOrNull(vhost.description),
    tags: Array.isArray(vhost.tags) ? (vhost.tags as string[]) : [],
    defaultQueueType: asStringOrNull(vhost.default_queue_type),
    tracing: vhost.tracing === true,
    messages: asNumberOrNull(vhost.messages),
    messagesReady: asNumberOrNull(vhost.messages_ready),
    messagesUnacknowledged: asNumberOrNull(vhost.messages_unacknowledged),
    clusterState: toRecord(vhost.cluster_state),
  }
}

export function projectConnection(raw: unknown): RabbitmqConnection {
  const connection = toRecord(raw)
  return {
    name: String(connection.name ?? ''),
    user: String(connection.user ?? ''),
    vhost: String(connection.vhost ?? ''),
    state: asStringOrNull(connection.state),
    protocol: asStringOrNull(connection.protocol),
    node: asStringOrNull(connection.node),
    channels: asNumberOrNull(connection.channels),
    peerHost: asStringOrNull(connection.peer_host),
    peerPort: asNumberOrNull(connection.peer_port),
    connectedAt: asNumberOrNull(connection.connected_at),
    ssl: connection.ssl === true,
  }
}

export function projectChannel(raw: unknown): RabbitmqChannel {
  const channel = toRecord(raw)
  const connectionDetails = toRecord(channel.connection_details)
  return {
    name: String(channel.name ?? ''),
    number: asNumberOrNull(channel.number),
    user: String(channel.user ?? ''),
    vhost: String(channel.vhost ?? ''),
    node: asStringOrNull(channel.node),
    state: asStringOrNull(channel.state),
    consumerCount: asNumberOrNull(channel.consumer_count),
    prefetchCount: asNumberOrNull(channel.prefetch_count),
    messagesUnacknowledged: asNumberOrNull(channel.messages_unacknowledged),
    confirm: channel.confirm === true,
    connectionName: asStringOrNull(connectionDetails.name),
  }
}

export function projectConsumer(raw: unknown): RabbitmqConsumer {
  const consumer = toRecord(raw)
  const queue = toRecord(consumer.queue)
  const channelDetails = toRecord(consumer.channel_details)
  return {
    consumerTag: String(consumer.consumer_tag ?? ''),
    queue: String(queue.name ?? ''),
    vhost: String(queue.vhost ?? ''),
    ackRequired: consumer.ack_required === true,
    active: consumer.active === true,
    activityStatus: asStringOrNull(consumer.activity_status),
    exclusive: consumer.exclusive === true,
    prefetchCount: asNumberOrNull(consumer.prefetch_count),
    channelName: asStringOrNull(channelDetails.name),
    connectionName: asStringOrNull(channelDetails.connection_name),
  }
}

export function projectNode(raw: unknown): RabbitmqNode {
  const node = toRecord(raw)
  return {
    name: String(node.name ?? ''),
    type: asStringOrNull(node.type),
    running: node.running === true,
    memUsed: asNumberOrNull(node.mem_used),
    memLimit: asNumberOrNull(node.mem_limit),
    memAlarm: node.mem_alarm === true,
    diskFree: asNumberOrNull(node.disk_free),
    diskFreeLimit: asNumberOrNull(node.disk_free_limit),
    diskFreeAlarm: node.disk_free_alarm === true,
    fdUsed: asNumberOrNull(node.fd_used),
    fdTotal: asNumberOrNull(node.fd_total),
    procUsed: asNumberOrNull(node.proc_used),
    procTotal: asNumberOrNull(node.proc_total),
    uptime: asNumberOrNull(node.uptime),
    partitions: Array.isArray(node.partitions) ? (node.partitions as string[]) : [],
    beingDrained: node.being_drained === true,
  }
}

export function projectPolicy(raw: unknown): RabbitmqPolicy {
  const policy = toRecord(raw)
  return {
    name: String(policy.name ?? ''),
    vhost: String(policy.vhost ?? ''),
    pattern: String(policy.pattern ?? ''),
    applyTo: asStringOrNull(policy['apply-to']),
    priority: asNumberOrNull(policy.priority),
    definition: toRecord(policy.definition),
  }
}

/** Columns requested from the connection and channel list endpoints. */
export const RABBITMQ_CONNECTION_COLUMNS = [
  'name',
  'user',
  'vhost',
  'state',
  'protocol',
  'node',
  'channels',
  'peer_host',
  'peer_port',
  'connected_at',
  'ssl',
].join(',')

export const RABBITMQ_CHANNEL_COLUMNS = [
  'name',
  'number',
  'user',
  'vhost',
  'node',
  'state',
  'consumer_count',
  'prefetch_count',
  'messages_unacknowledged',
  'confirm',
  'connection_details.name',
].join(',')

export const RABBITMQ_CONSUMER_COLUMNS = [
  'consumer_tag',
  'queue.name',
  'queue.vhost',
  'ack_required',
  'active',
  'activity_status',
  'exclusive',
  'prefetch_count',
  'channel_details.name',
  'channel_details.connection_name',
].join(',')

export const RABBITMQ_NODE_COLUMNS = [
  'name',
  'type',
  'running',
  'mem_used',
  'mem_limit',
  'mem_alarm',
  'disk_free',
  'disk_free_limit',
  'disk_free_alarm',
  'fd_used',
  'fd_total',
  'proc_used',
  'proc_total',
  'uptime',
  'partitions',
  'being_drained',
].join(',')
