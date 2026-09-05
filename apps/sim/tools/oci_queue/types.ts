import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface OciQueueAuthParams {
  oauthCredential: string
  region?: string
}

export interface OciQueuePageParams {
  limit?: number
  page?: string
}

export interface OciQueueTargetParams extends OciQueueAuthParams {
  queueId: string
}

export interface OciQueueConsumerParams extends OciQueueTargetParams {
  consumerGroupId?: string
}

export interface OciQueueConfiguration {
  displayName?: string
  visibilityInSeconds?: number
  timeoutInSeconds?: number
  deadLetterQueueDeliveryCount?: number
  channelConsumptionLimit?: number
  customEncryptionKeyId?: string
  freeformTags?: Record<string, string>
  definedTags?: Record<string, Record<string, string | number | boolean>>
}

export interface OciQueueListQueuesParams extends OciQueueAuthParams, OciQueuePageParams {
  compartmentId?: string
  displayName?: string
  id?: string
  lifecycleState?: string
  sortBy?: 'timeCreated' | 'displayName'
  sortOrder?: 'ASC' | 'DESC'
}

export interface OciQueueGetQueueParams extends OciQueueTargetParams {}

export interface OciQueueCreateQueueParams extends OciQueueAuthParams, OciQueueConfiguration {
  displayName: string
  compartmentId: string
  retentionInSeconds?: number
  retryToken?: string
}

export interface OciQueueUpdateQueueParams extends OciQueueTargetParams, OciQueueConfiguration {
  ifMatch?: string
}

export interface OciQueueDeleteQueueParams extends OciQueueTargetParams {
  ifMatch?: string
}

export interface OciQueueChangeQueueCompartmentParams extends OciQueueDeleteQueueParams {
  destinationCompartmentId: string
}

export interface OciQueuePurgeQueueParams extends OciQueueConsumerParams {
  purgeType: 'NORMAL' | 'DLQ' | 'BOTH'
  channelIds?: string[]
  ifMatch?: string
}

export interface OciQueueMessageMetadata {
  channelId: string
  customProperties?: Record<string, string>
}

export interface OciQueuePutMessagesParams extends OciQueueTargetParams {
  messages: { content: string; metadata?: OciQueueMessageMetadata }[]
}

export interface OciQueueGetMessagesParams extends OciQueueConsumerParams {
  limit?: number
  timeoutInSeconds?: number
  visibilityInSeconds?: number
  channelFilter?: string
}

export interface OciQueueDeleteMessageParams extends OciQueueConsumerParams {
  messageReceipt: string
}

export interface OciQueueDeleteMessagesParams extends OciQueueConsumerParams {
  entries: { receipt: string }[]
}

export interface OciQueueUpdateMessageParams extends OciQueueDeleteMessageParams {
  visibilityInSeconds: number
}

export interface OciQueueUpdateMessagesParams extends OciQueueConsumerParams {
  entries: { receipt: string; visibilityInSeconds: number }[]
}

export interface OciQueueGetStatsParams extends OciQueueConsumerParams {
  channelId?: string
}

export interface OciQueueListChannelsParams extends OciQueueConsumerParams, OciQueuePageParams {
  channelFilter?: string
}

export interface OciQueueListWorkRequestsParams extends OciQueueAuthParams, OciQueuePageParams {
  compartmentId?: string
  workRequestId?: string
}

export interface OciQueueGetWorkRequestParams extends OciQueueAuthParams {
  workRequestId: string
}

export interface OciQueueListWorkRequestErrorsParams
  extends OciQueueGetWorkRequestParams,
    OciQueuePageParams {}

export interface OciQueueListWorkRequestLogsParams
  extends OciQueueGetWorkRequestParams,
    OciQueuePageParams {}

export interface OciQueueSummary {
  id: string
  compartmentId: string
  displayName?: string
  lifecycleState: string
  lifecycleDetails?: string
  timeCreated: string
  timeUpdated: string
  messagesEndpoint: string
  capabilities?: string[]
  freeformTags?: Record<string, string>
  definedTags?: Record<string, Record<string, unknown>>
  systemTags?: Record<string, Record<string, unknown>>
}

export interface OciQueue extends OciQueueSummary {
  retentionInSeconds: number
  visibilityInSeconds: number
  timeoutInSeconds: number
  deadLetterQueueDeliveryCount: number
  channelConsumptionLimit?: number
  customEncryptionKeyId?: string
}

export interface OciQueuePublishedMessage {
  id: string
  expireAfter?: string
}

export interface OciQueueReceivedMessage extends OciQueuePublishedMessage {
  content: string
  receipt: string
  deliveryCount: number
  createdAt: string
  visibleAfter: string
  expireAfter: string
  metadata?: OciQueueMessageMetadata
}

export interface OciQueueUpdatedMessage {
  id: string
  visibleAfter: string
}

export interface OciQueueBatchEntry {
  index: number
  success: boolean
  errorCode?: number
  errorMessage?: string
  id?: string
  visibleAfter?: string
}

export interface OciQueueBatchResult {
  entries: OciQueueBatchEntry[]
  clientFailures: number
  serverFailures: number
  allSucceeded: boolean
}

export interface OciQueueStats {
  queue: { visibleMessages: number; inFlightMessages: number; sizeInBytes: number }
  dlq: { visibleMessages: number; inFlightMessages: number; sizeInBytes: number }
  channelId?: string
  consumerGroupId?: string
}

export interface OciQueueWorkRequest {
  id: string
  operationType: string
  status: string
  compartmentId: string
  percentComplete: number
  timeAccepted: string
  timeStarted?: string
  timeFinished?: string
  resources: {
    actionType: string
    entityType: string
    identifier: string
    entityUri?: string
  }[]
}

export interface OciQueueOutput {
  status: number
  requestId?: string
  etag?: string
  nextPage?: string
  workRequestId?: string
  retryAfter?: number
  queue?: OciQueue
  queues?: OciQueueSummary[]
  messages?: (OciQueuePublishedMessage | OciQueueReceivedMessage)[]
  updatedMessage?: OciQueueUpdatedMessage
  entries?: OciQueueBatchEntry[]
  clientFailures?: number
  serverFailures?: number
  allSucceeded?: boolean
  stats?: OciQueueStats
  channels?: string[]
  workRequest?: OciQueueWorkRequest
  workRequests?: OciQueueWorkRequest[]
  errors?: { code: string; message: string; timestamp: string }[]
  logs?: { message: string; timestamp: string }[]
}

export interface OciQueueResponse extends ToolResponse {
  output: OciQueueOutput
}

export interface OciQueueAcceptedResponse extends OciQueueResponse {
  output: OciQueueOutput & { workRequestId: string }
}

export interface OciQueueBatchResponse extends OciQueueResponse {
  output: OciQueueOutput & OciQueueBatchResult
}

export const OCI_QUEUE_QUEUE_PROPERTIES = {
  id: { type: 'string', description: 'Queue OCID.' },
  compartmentId: { type: 'string', description: 'Compartment OCID.' },
  displayName: { type: 'string', description: 'Display name.', optional: true },
  lifecycleState: { type: 'string', description: 'Queue lifecycle state.' },
  lifecycleDetails: { type: 'string', description: 'Lifecycle details.', optional: true },
  timeCreated: { type: 'string', description: 'Creation timestamp.' },
  timeUpdated: { type: 'string', description: 'Last update timestamp.' },
  messagesEndpoint: { type: 'string', description: 'Oracle message endpoint; informational only.' },
  capabilities: {
    type: 'array',
    description: 'Enabled capability names.',
    items: { type: 'string' },
    optional: true,
  },
  freeformTags: { type: 'object', description: 'Freeform string tags.', optional: true },
  definedTags: { type: 'object', description: 'Namespaced defined tags.', optional: true },
  systemTags: { type: 'object', description: 'System tags.', optional: true },
} as const

export const OCI_QUEUE_WORK_REQUEST_PROPERTIES = {
  id: { type: 'string', description: 'Work request OCID.' },
  compartmentId: { type: 'string', description: 'Compartment OCID.' },
  operationType: { type: 'string', description: 'Asynchronous operation type.' },
  status: { type: 'string', description: 'Observed work request status.' },
  percentComplete: { type: 'number', description: 'Completion percentage.' },
  timeAccepted: { type: 'string', description: 'Acceptance timestamp.' },
  timeStarted: { type: 'string', description: 'Start timestamp.', optional: true },
  timeFinished: { type: 'string', description: 'Finish timestamp.', optional: true },
  resources: {
    type: 'array',
    description: 'Affected resources.',
    items: {
      type: 'object',
      properties: {
        actionType: { type: 'string', description: 'Resource action.' },
        entityType: { type: 'string', description: 'Resource type.' },
        identifier: { type: 'string', description: 'Resource identifier.' },
        entityUri: { type: 'string', description: 'Resource URI.', optional: true },
      },
    },
  },
} as const

export const OCI_QUEUE_STATS_PROPERTIES = {
  visibleMessages: { type: 'number', description: 'Messages available for delivery.' },
  inFlightMessages: { type: 'number', description: 'Messages currently invisible.' },
  sizeInBytes: { type: 'number', description: 'Retained message bytes.' },
} as const

export const OCI_QUEUE_STATUS_OUTPUT = {
  type: 'number',
  description: 'HTTP status from Oracle.',
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_REQUEST_ID_OUTPUT = {
  type: 'string',
  description: 'Oracle request ID.',
  optional: true,
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_ETAG_OUTPUT = {
  type: 'string',
  description: 'ETag for conditional management updates.',
  optional: true,
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_NEXT_PAGE_OUTPUT = {
  type: 'string',
  description: 'Opaque token for the next page; absent at the end.',
  optional: true,
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_WORK_REQUEST_ID_OUTPUT = {
  type: 'string',
  description: 'Accepted asynchronous work request OCID.',
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_RETRY_AFTER_OUTPUT = {
  type: 'number',
  description: 'Suggested seconds before checking work request status again.',
  optional: true,
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_QUEUE_OUTPUT = {
  type: 'object',
  description: 'Queue configuration. Capabilities are projected as names.',
  properties: {
    ...OCI_QUEUE_QUEUE_PROPERTIES,
    retentionInSeconds: { type: 'number', description: 'Message retention duration.' },
    visibilityInSeconds: { type: 'number', description: 'Default visibility duration.' },
    timeoutInSeconds: { type: 'number', description: 'Default polling duration.' },
    deadLetterQueueDeliveryCount: {
      type: 'number',
      description: 'Dead-letter delivery threshold; zero disables it.',
    },
    channelConsumptionLimit: {
      type: 'number',
      description: 'Channel consumption percentage.',
      optional: true,
    },
    customEncryptionKeyId: {
      type: 'string',
      description: 'Optional KMS key OCID.',
      optional: true,
    },
  },
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_QUEUES_OUTPUT = {
  type: 'array',
  description: 'One page of queue summaries.',
  items: {
    type: 'object',
    properties: OCI_QUEUE_QUEUE_PROPERTIES,
  },
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_MESSAGES_PUBLISHED_OUTPUT = {
  type: 'array',
  description: 'Published message results in provider order. IDs are lossless decimal strings.',
  items: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Oracle int64 message ID as a decimal string.',
      },
      expireAfter: {
        type: 'string',
        description: 'Expiration timestamp when returned.',
        optional: true,
      },
    },
  },
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_MESSAGES_RECEIVED_OUTPUT = {
  type: 'array',
  description:
    'Received messages. Only successful processing should be acknowledged by the current receipt.',
  items: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Oracle int64 message ID as a decimal string.',
      },
      receipt: {
        type: 'string',
        description: 'Opaque current receipt for acknowledgement and visibility updates.',
      },
      content: {
        type: 'string',
        description: 'Message content.',
      },
      deliveryCount: {
        type: 'number',
        description: 'Number of deliveries.',
      },
      createdAt: {
        type: 'string',
        description: 'Creation timestamp.',
      },
      visibleAfter: {
        type: 'string',
        description: 'Next visibility timestamp.',
      },
      expireAfter: {
        type: 'string',
        description: 'Expiration timestamp.',
      },
      metadata: {
        type: 'object',
        description: 'Channel ID and optional custom properties.',
        optional: true,
        properties: {
          channelId: { type: 'string', description: 'Message channel ID.' },
          customProperties: {
            type: 'object',
            description: 'Custom string properties.',
            optional: true,
          },
        },
      },
    },
  },
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_UPDATED_MESSAGE_OUTPUT = {
  type: 'object',
  description: 'Message ID and new visibility timestamp.',
  properties: {
    id: {
      type: 'string',
      description: 'Lossless decimal message ID.',
    },
    visibleAfter: {
      type: 'string',
      description: 'New visibility timestamp.',
    },
  },
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_ENTRIES_OUTPUT = {
  type: 'array',
  description: 'Per-entry outcomes in request order.',
  items: {
    type: 'object',
    properties: {
      index: {
        type: 'number',
        description: 'Zero-based request entry index.',
      },
      success: {
        type: 'boolean',
        description: 'Whether this entry succeeded.',
      },
      errorCode: {
        type: 'number',
        description: 'Oracle failure code.',
        optional: true,
      },
      errorMessage: {
        type: 'string',
        description: 'Oracle entry error.',
        optional: true,
      },
      id: {
        type: 'string',
        description: 'Updated message ID as a decimal string.',
        optional: true,
      },
      visibleAfter: {
        type: 'string',
        description: 'New visibility timestamp for successful updates.',
        optional: true,
      },
    },
  },
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_DELETE_ENTRIES_OUTPUT = {
  type: 'array',
  description: 'Acknowledgement outcomes in request order.',
  items: {
    type: 'object',
    properties: {
      index: { type: 'number', description: 'Zero-based request entry index.' },
      success: { type: 'boolean', description: 'Whether this entry succeeded.' },
      errorCode: { type: 'number', description: 'Oracle failure code.', optional: true },
      errorMessage: { type: 'string', description: 'Oracle entry error.', optional: true },
    },
  },
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_CLIENT_FAILURES_OUTPUT = {
  type: 'number',
  description: 'Number of client failures in this batch.',
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_SERVER_FAILURES_OUTPUT = {
  type: 'number',
  description: 'Number of server failures in this batch.',
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_ALL_SUCCEEDED_OUTPUT = {
  type: 'boolean',
  description: 'True when both Oracle failure counts are zero.',
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_SCOPED_STATS_PROPERTIES = {
  queue: {
    type: 'object',
    description: 'Normal queue statistics.',
    properties: OCI_QUEUE_STATS_PROPERTIES,
  },
  dlq: {
    type: 'object',
    description: 'Dead-letter queue statistics.',
    properties: OCI_QUEUE_STATS_PROPERTIES,
  },
  channelId: { type: 'string', description: 'Requested channel scope.', optional: true },
  consumerGroupId: {
    type: 'string',
    description: 'Requested consumer group scope.',
    optional: true,
  },
} as const

export const OCI_QUEUE_STATS_OUTPUT = {
  type: 'object',
  description:
    'Queue and DLQ visibleMessages, inFlightMessages, and sizeInBytes; optional channel/group scope.',
  properties: OCI_QUEUE_SCOPED_STATS_PROPERTIES,
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_CHANNELS_OUTPUT = {
  type: 'array',
  description: 'Approximate page of nonempty channel IDs.',
  items: {
    type: 'string',
  },
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_WORK_REQUEST_OUTPUT = {
  type: 'object',
  description: 'Asynchronous status, completion percentage, timestamps, and affected resources.',
  properties: OCI_QUEUE_WORK_REQUEST_PROPERTIES,
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_WORK_REQUESTS_OUTPUT = {
  type: 'array',
  description: 'One page of asynchronous work requests.',
  items: {
    type: 'object',
    properties: OCI_QUEUE_WORK_REQUEST_PROPERTIES,
  },
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_ERRORS_OUTPUT = {
  type: 'array',
  description: 'One page of work request errors.',
  items: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Error code.',
      },
      message: {
        type: 'string',
        description: 'Error message.',
      },
      timestamp: {
        type: 'string',
        description: 'Error timestamp.',
      },
    },
  },
} satisfies NonNullable<ToolConfig['outputs']>[string]

export const OCI_QUEUE_LOGS_OUTPUT = {
  type: 'array',
  description: 'One page of work request logs.',
  items: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Log message.',
      },
      timestamp: {
        type: 'string',
        description: 'Log timestamp.',
      },
    },
  },
} satisfies NonNullable<ToolConfig['outputs']>[string]
