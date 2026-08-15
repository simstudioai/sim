import type { ToolResponse } from '@/tools/types'

/**
 * Connection parameters shared by every RabbitMQ tool. All operations go through the
 * RabbitMQ Management HTTP API, which authenticates with HTTP basic auth.
 *
 * @see https://www.rabbitmq.com/docs/management#http-api
 */
interface RabbitmqBaseParams {
  /** Management API base URL, e.g. `https://rabbit.example.com:15672`. */
  host: string
  username: string
  password: string
  /** Virtual host the operation targets. Defaults to `/`. */
  vhost?: string
}

export interface RabbitmqPublishMessageParams extends RabbitmqBaseParams {
  /** Empty targets the default exchange, which routes by queue name. */
  exchange?: string
  routingKey: string
  payload: string
  payloadEncoding?: 'string' | 'base64'
  /** AMQP basic properties as a JSON object string, e.g. `{"delivery_mode":2}`. */
  properties?: string
  /** Message headers as a JSON object string. Merged into the AMQP properties. */
  headers?: string
}

export interface RabbitmqGetMessagesParams extends RabbitmqBaseParams {
  queue: string
  count?: number
  ackmode?:
    | 'ack_requeue_true'
    | 'ack_requeue_false'
    | 'reject_requeue_true'
    | 'reject_requeue_false'
  encoding?: 'auto' | 'base64'
  /** Truncate payloads longer than this many bytes. */
  truncate?: number
}

export interface RabbitmqListQueuesParams extends RabbitmqBaseParams {
  page?: number
  pageSize?: number
  /** Filters returned queues by name. Treated as a regular expression when `useRegex` is set. */
  name?: string
  useRegex?: boolean
}

export interface RabbitmqGetQueueParams extends RabbitmqBaseParams {
  queue: string
}

export interface RabbitmqCreateQueueParams extends RabbitmqBaseParams {
  queue: string
  durable?: boolean
  autoDelete?: boolean
  /** Optional queue arguments as a JSON object string, e.g. `{"x-queue-type":"quorum"}`. */
  arguments?: string
}

export interface RabbitmqDeleteQueueParams extends RabbitmqBaseParams {
  queue: string
  ifUnused?: boolean
  ifEmpty?: boolean
}

export interface RabbitmqPurgeQueueParams extends RabbitmqBaseParams {
  queue: string
}

export interface RabbitmqGetExchangeParams extends RabbitmqBaseParams {
  exchange?: string
}

export interface RabbitmqCreateExchangeParams extends RabbitmqBaseParams {
  exchange: string
  exchangeType?: 'direct' | 'fanout' | 'topic' | 'headers'
  durable?: boolean
  autoDelete?: boolean
  internal?: boolean
  /** Optional exchange arguments as a JSON object string, e.g. `{"alternate-exchange":"dlx"}`. */
  arguments?: string
}

export interface RabbitmqDeleteExchangeParams extends RabbitmqBaseParams {
  exchange: string
  ifUnused?: boolean
}

export interface RabbitmqListExchangeBindingsParams extends RabbitmqBaseParams {
  exchange?: string
}

export interface RabbitmqDeleteBindingParams extends RabbitmqBaseParams {
  exchange: string
  destination: string
  destinationType?: 'queue' | 'exchange'
  /** Broker identifier for the binding, as returned by Create Binding or List Bindings. */
  propertiesKey: string
}

export type RabbitmqListVhostsParams = RabbitmqBaseParams

export interface RabbitmqListConnectionsParams extends RabbitmqBaseParams {
  page?: number
  pageSize?: number
  name?: string
  useRegex?: boolean
}

export interface RabbitmqListChannelsParams extends RabbitmqBaseParams {
  page?: number
  pageSize?: number
  name?: string
  useRegex?: boolean
}

export type RabbitmqListConsumersParams = RabbitmqBaseParams

export type RabbitmqListNodesParams = RabbitmqBaseParams

export interface RabbitmqHealthCheckParams extends RabbitmqBaseParams {
  check?:
    | 'alarms'
    | 'local-alarms'
    | 'virtual-hosts'
    | 'node-is-quorum-critical'
    | 'port-listener'
    | 'protocol-listener'
    | 'certificate-expiration'
  port?: number
  protocol?: string
  within?: number
  unit?: 'days' | 'weeks' | 'months' | 'years'
}

export type RabbitmqListPoliciesParams = RabbitmqBaseParams

export interface RabbitmqCreatePolicyParams extends RabbitmqBaseParams {
  policyName: string
  pattern: string
  /** Policy definition as a JSON object string, e.g. `{"dead-letter-exchange":"dlx"}`. */
  definition: string
  priority?: number
  applyTo?: 'all' | 'queues' | 'classic_queues' | 'quorum_queues' | 'streams' | 'exchanges'
}

export interface RabbitmqDeletePolicyParams extends RabbitmqBaseParams {
  policyName: string
}

export interface RabbitmqListExchangesParams extends RabbitmqBaseParams {
  page?: number
  pageSize?: number
  name?: string
  useRegex?: boolean
}

export interface RabbitmqListBindingsParams extends RabbitmqBaseParams {
  queue: string
}

export interface RabbitmqCreateBindingParams extends RabbitmqBaseParams {
  exchange: string
  queue: string
  destinationType?: 'queue' | 'exchange'
  routingKey?: string
  /** Optional binding arguments as a JSON object string. */
  arguments?: string
}

export type RabbitmqGetOverviewParams = RabbitmqBaseParams

/** Projected queue record. Statistics fields are absent until the broker collects stats. */
export interface RabbitmqQueue {
  name: string
  vhost: string
  type: string | null
  state: string | null
  durable: boolean | null
  autoDelete: boolean | null
  exclusive: boolean | null
  node: string | null
  policy: string | null
  arguments: Record<string, unknown>
  messages: number | null
  messagesReady: number | null
  messagesUnacknowledged: number | null
  consumers: number | null
  memory: number | null
}

export interface RabbitmqExchange {
  name: string
  vhost: string
  type: string
  durable: boolean
  autoDelete: boolean
  internal: boolean
  arguments: Record<string, unknown>
}

export interface RabbitmqBinding {
  source: string
  vhost: string
  destination: string
  destinationType: string
  routingKey: string
  propertiesKey: string
  arguments: Record<string, unknown>
}

export interface RabbitmqMessage {
  payload: string
  /** True when the broker cut the payload short at the requested truncate limit. */
  truncated: boolean
  payloadBytes: number
  payloadEncoding: string
  exchange: string
  routingKey: string
  redelivered: boolean
  /** Messages still left in the queue after this one was retrieved. */
  messageCount: number
  properties: Record<string, unknown>
}

export interface RabbitmqPublishMessageResponse extends ToolResponse {
  output: {
    routed: boolean
    exchange: string
    routingKey: string
  }
}

export interface RabbitmqGetMessagesResponse extends ToolResponse {
  output: {
    queueName: string
    count: number
    messages: RabbitmqMessage[]
  }
}

export interface RabbitmqListQueuesResponse extends ToolResponse {
  output: {
    queues: RabbitmqQueue[]
    count: number
    totalCount: number | null
    page: number | null
    pageCount: number | null
  }
}

export interface RabbitmqGetQueueResponse extends ToolResponse {
  output: {
    queue: RabbitmqQueue
  }
}

export interface RabbitmqCreateQueueResponse extends ToolResponse {
  output: {
    queueName: string
    vhost: string
    created: boolean
  }
}

export interface RabbitmqDeleteQueueResponse extends ToolResponse {
  output: {
    queueName: string
    vhost: string
    deleted: boolean
  }
}

export interface RabbitmqPurgeQueueResponse extends ToolResponse {
  output: {
    queueName: string
    vhost: string
    purged: boolean
  }
}

export interface RabbitmqVhost {
  name: string
  description: string | null
  tags: string[]
  defaultQueueType: string | null
  tracing: boolean
  messages: number | null
  messagesReady: number | null
  messagesUnacknowledged: number | null
  clusterState: Record<string, unknown>
}

export interface RabbitmqConnection {
  name: string
  user: string
  vhost: string
  state: string | null
  protocol: string | null
  node: string | null
  channels: number | null
  peerHost: string | null
  peerPort: number | null
  connectedAt: number | null
  ssl: boolean
}

export interface RabbitmqChannel {
  name: string
  number: number | null
  user: string
  vhost: string
  node: string | null
  state: string | null
  consumerCount: number | null
  prefetchCount: number | null
  messagesUnacknowledged: number | null
  confirm: boolean
  connectionName: string | null
}

export interface RabbitmqConsumer {
  consumerTag: string
  queue: string
  vhost: string
  ackRequired: boolean
  active: boolean
  activityStatus: string | null
  exclusive: boolean
  prefetchCount: number | null
  channelName: string | null
  connectionName: string | null
}

export interface RabbitmqNode {
  name: string
  type: string | null
  running: boolean
  memUsed: number | null
  memLimit: number | null
  memAlarm: boolean
  diskFree: number | null
  diskFreeLimit: number | null
  diskFreeAlarm: boolean
  fdUsed: number | null
  fdTotal: number | null
  procUsed: number | null
  procTotal: number | null
  uptime: number | null
  partitions: string[]
  beingDrained: boolean
}

export interface RabbitmqPolicy {
  name: string
  vhost: string
  pattern: string
  applyTo: string | null
  priority: number | null
  definition: Record<string, unknown>
}

export interface RabbitmqGetExchangeResponse extends ToolResponse {
  output: {
    exchange: RabbitmqExchange
  }
}

export interface RabbitmqCreateExchangeResponse extends ToolResponse {
  output: {
    exchangeName: string
    vhost: string
    created: boolean
  }
}

export interface RabbitmqDeleteExchangeResponse extends ToolResponse {
  output: {
    exchangeName: string
    vhost: string
    deleted: boolean
  }
}

export interface RabbitmqListExchangeBindingsResponse extends ToolResponse {
  output: {
    exchangeName: string
    bindings: RabbitmqBinding[]
    count: number
  }
}

export interface RabbitmqDeleteBindingResponse extends ToolResponse {
  output: {
    exchange: string
    destination: string
    propertiesKey: string
    deleted: boolean
  }
}

export interface RabbitmqListVhostsResponse extends ToolResponse {
  output: {
    vhosts: RabbitmqVhost[]
    count: number
  }
}

export interface RabbitmqListConnectionsResponse extends ToolResponse {
  output: {
    connections: RabbitmqConnection[]
    count: number
    totalCount: number | null
    page: number | null
    pageCount: number | null
  }
}

export interface RabbitmqListChannelsResponse extends ToolResponse {
  output: {
    channels: RabbitmqChannel[]
    count: number
    totalCount: number | null
    page: number | null
    pageCount: number | null
  }
}

export interface RabbitmqListConsumersResponse extends ToolResponse {
  output: {
    consumers: RabbitmqConsumer[]
    count: number
  }
}

export interface RabbitmqListNodesResponse extends ToolResponse {
  output: {
    nodes: RabbitmqNode[]
    count: number
  }
}

export interface RabbitmqHealthCheckResponse extends ToolResponse {
  output: {
    check: string
    healthy: boolean
    status: string
    reason: string | null
    details: Record<string, unknown>
  }
}

export interface RabbitmqListPoliciesResponse extends ToolResponse {
  output: {
    policies: RabbitmqPolicy[]
    count: number
  }
}

export interface RabbitmqCreatePolicyResponse extends ToolResponse {
  output: {
    policyName: string
    vhost: string
    created: boolean
  }
}

export interface RabbitmqDeletePolicyResponse extends ToolResponse {
  output: {
    policyName: string
    vhost: string
    deleted: boolean
  }
}

export interface RabbitmqListExchangesResponse extends ToolResponse {
  output: {
    exchanges: RabbitmqExchange[]
    count: number
    totalCount: number | null
    page: number | null
    pageCount: number | null
  }
}

export interface RabbitmqListBindingsResponse extends ToolResponse {
  output: {
    queueName: string
    bindings: RabbitmqBinding[]
    count: number
  }
}

export interface RabbitmqCreateBindingResponse extends ToolResponse {
  output: {
    exchange: string
    queueName: string
    routingKey: string
    /** Binding identifier returned by the broker, used to address the binding later. */
    propertiesKey: string | null
    created: boolean
  }
}

export interface RabbitmqGetOverviewResponse extends ToolResponse {
  output: {
    rabbitmqVersion: string | null
    productName: string | null
    productVersion: string | null
    erlangVersion: string | null
    clusterName: string | null
    node: string | null
    objectTotals: Record<string, unknown>
    queueTotals: Record<string, unknown>
    messageStats: Record<string, unknown>
  }
}

export type RabbitmqResponse =
  | RabbitmqPublishMessageResponse
  | RabbitmqGetMessagesResponse
  | RabbitmqListQueuesResponse
  | RabbitmqGetQueueResponse
  | RabbitmqCreateQueueResponse
  | RabbitmqDeleteQueueResponse
  | RabbitmqPurgeQueueResponse
  | RabbitmqListExchangesResponse
  | RabbitmqListBindingsResponse
  | RabbitmqCreateBindingResponse
  | RabbitmqGetOverviewResponse
  | RabbitmqGetExchangeResponse
  | RabbitmqCreateExchangeResponse
  | RabbitmqDeleteExchangeResponse
  | RabbitmqListExchangeBindingsResponse
  | RabbitmqDeleteBindingResponse
  | RabbitmqListVhostsResponse
  | RabbitmqListConnectionsResponse
  | RabbitmqListChannelsResponse
  | RabbitmqListConsumersResponse
  | RabbitmqListNodesResponse
  | RabbitmqHealthCheckResponse
  | RabbitmqListPoliciesResponse
  | RabbitmqCreatePolicyResponse
  | RabbitmqDeletePolicyResponse
