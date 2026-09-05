import type { ToolOutputProperty, ToolResponse } from '@/tools/types'

export interface OciStreamingListStreamsParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  compartmentId?: string
  streamPoolId?: string
  id?: string
  name?: string
  lifecycleState?: string
  limit?: number
  page?: string
  sortBy?: string
  sortOrder?: string
}

export interface OciStreamingGetStreamParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  streamId: string
}

export interface OciStreamingCreateStreamParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  name: string
  partitions: number
  compartmentId?: string
  streamPoolId?: string
  retentionInHours?: number
  freeformTags?: Record<string, string>
  definedTags?: Record<string, Record<string, string>>
}

export interface OciStreamingUpdateStreamParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  streamId: string
  streamPoolId?: string
  freeformTags?: Record<string, string>
  definedTags?: Record<string, Record<string, string>>
  ifMatch?: string
}

export interface OciStreamingDeleteStreamParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  streamId: string
  ifMatch?: string
}

export interface OciStreamingChangeStreamCompartmentParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  streamId: string
  compartmentId: string
  ifMatch?: string
}

export interface OciStreamingListStreamPoolsParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  compartmentId: string
  id?: string
  name?: string
  lifecycleState?: string
  limit?: number
  page?: string
  sortBy?: string
  sortOrder?: string
}

export interface OciStreamingGetStreamPoolParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  streamPoolId: string
}

export interface OciStreamingCreateStreamPoolParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  name: string
  compartmentId: string
  freeformTags?: Record<string, string>
  definedTags?: Record<string, Record<string, string>>
  customEncryptionKeyDetails?: { kmsKeyId: string }
  kafkaSettings?: {
    autoCreateTopicsEnable?: boolean
    logRetentionHours?: number
    numPartitions?: number
  }
  retryToken?: string
}

export interface OciStreamingUpdateStreamPoolParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  streamPoolId: string
  name?: string
  freeformTags?: Record<string, string>
  definedTags?: Record<string, Record<string, string>>
  customEncryptionKeyDetails?: { kmsKeyId: string }
  kafkaSettings?: {
    autoCreateTopicsEnable?: boolean
    logRetentionHours?: number
    numPartitions?: number
  }
  ifMatch?: string
}

export interface OciStreamingDeleteStreamPoolParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  streamPoolId: string
  ifMatch?: string
}

export interface OciStreamingChangeStreamPoolCompartmentParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  streamPoolId: string
  compartmentId: string
  ifMatch?: string
}

export interface OciStreamingPutMessagesParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  streamId: string
  messages: Array<{ key?: string | null; value: string }>
  encoding?: 'utf-8' | 'base64'
}

export interface OciStreamingCreateCursorParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  streamId: string
  partition: string
  type: string
  offset?: string
  time?: string
}

export interface OciStreamingCreateGroupCursorParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  streamId: string
  groupName: string
  type: string
  time?: string
  instanceName?: string
  timeoutInMs?: number
  commitOnGet?: boolean
}

export interface OciStreamingGetMessagesParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  streamId: string
  cursor: string
  limit?: number
}

export interface OciStreamingGetGroupParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  streamId: string
  groupName: string
}

export interface OciStreamingUpdateGroupParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  streamId: string
  groupName: string
  type: string
  time?: string
}

export interface OciStreamingConsumerCommitParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  streamId: string
  cursor: string
}

export interface OciStreamingConsumerHeartbeatParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  streamId: string
  cursor: string
}

export interface OciStreamingListWorkRequestsParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  compartmentId: string
  workRequestId?: string
  resourceId?: string
  limit?: number
  page?: string
  sortBy?: string
  sortOrder?: string
}

export interface OciStreamingGetWorkRequestParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  workRequestId: string
}

export interface OciStreamingListWorkRequestErrorsParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  workRequestId: string
  limit?: number
  page?: string
}

export interface OciStreamingListWorkRequestLogsParams {
  ociCredential: string
  ociRegion?: string
  requestId?: string
  workRequestId: string
  limit?: number
  page?: string
}

export interface OciStreamSummary {
  id: string
  name: string
  compartmentId: string
  lifecycleState: string
  timeCreated: string
  freeformTags?: Record<string, unknown>
  definedTags?: Record<string, unknown>
  streamPoolId: string
  partitions: number
  messagesEndpoint: string
}

export interface OciStream {
  id: string
  name: string
  compartmentId: string
  lifecycleState: string
  timeCreated: string
  freeformTags?: Record<string, unknown>
  definedTags?: Record<string, unknown>
  streamPoolId: string
  partitions: number
  messagesEndpoint: string
  retentionInHours: number
  lifecycleStateDetails?: string | null
}

export interface OciStreamPoolSummary {
  id: string
  name: string
  compartmentId: string
  lifecycleState: string
  timeCreated: string
  freeformTags?: Record<string, unknown>
  definedTags?: Record<string, unknown>
  isPrivate?: boolean | null
}

export interface OciStreamPool {
  id: string
  name: string
  compartmentId: string
  lifecycleState: string
  timeCreated: string
  freeformTags?: Record<string, unknown>
  definedTags?: Record<string, unknown>
  isPrivate?: boolean | null
  endpointFqdn?: string | null
  lifecycleStateDetails?: string | null
  kafkaSettings: {
    autoCreateTopicsEnable?: boolean | null
    bootstrapServers?: string | null
    logRetentionHours?: number
    numPartitions?: number
  }
  customEncryptionKey: { kmsKeyId?: string | null; keyState?: string | null }
  privateEndpointSettings?: {
    nsgIds?: Array<string>
    privateEndpointIp?: string | null
    subnetId?: string | null
  } | null
}

export interface OciStreamingMessage {
  stream: string
  partition: string
  key: string | null
  value: string
  offset: string
  timestamp: string
}

export interface OciStreamingPublishEntry {
  error?: string | null
  errorMessage?: string | null
  offset?: string | null
  partition?: string | null
  timestamp?: string | null
}

export interface OciStreamingGroup {
  streamId: string
  groupName: string
  reservations: Array<{
    partition?: string | null
    committedOffset?: string | null
    reservedInstance?: string | null
    timeReservedUntil?: string | null
  }>
}

export interface OciStreamingWorkRequest {
  id: string
  compartmentId: string
  operationType: string
  status: string
  percentComplete: number
  timeAccepted: string
  timeStarted?: string | null
  timeFinished?: string | null
  resources: Array<{
    actionType: string
    entityType: string
    identifier: string
    entityUri?: string | null
  }>
}

export interface OciStreamingWorkRequestError {
  code: string
  message: string
  timestamp: string
}

export interface OciStreamingWorkRequestLog {
  message: string
  timestamp: string
}

export interface OciStreamingResponse extends ToolResponse {
  output: {
    status: number
    requestId: string | null
    etag: string | null
    workRequestId: string | null
    nextPage?: string | null
    streams?: OciStreamSummary[]
    stream?: OciStream
    streamPools?: OciStreamPoolSummary[]
    streamPool?: OciStreamPool
    messages?: OciStreamingMessage[]
    nextCursor?: string
    cursor?: string
    entries?: OciStreamingPublishEntry[]
    failures?: number
    allSucceeded?: boolean
    group?: OciStreamingGroup
    workRequests?: OciStreamingWorkRequest[]
    workRequest?: OciStreamingWorkRequest
    errors?: OciStreamingWorkRequestError[]
    logs?: OciStreamingWorkRequestLog[]
  }
}

export const OCI_STREAMING_RESPONSE_OUTPUTS = {
  status: {
    type: 'number',
    description:
      'HTTP success status; inspect lifecycle state or work request for asynchronous completion.',
  },
  requestId: {
    type: 'string',
    description: 'Oracle request identifier.',
    nullable: true,
  },
  etag: {
    type: 'string',
    description: 'Resource ETag when provided by Oracle.',
    nullable: true,
  },
  workRequestId: {
    type: 'string',
    description: 'Asynchronous work request OCID when provided by Oracle.',
    nullable: true,
  },
} satisfies Record<string, ToolOutputProperty>

export const OCI_STREAMING_NEXT_PAGE_OUTPUT = {
  type: 'string',
  description: 'Opaque administrative continuation token, or null when this list has no next page.',
  nullable: true,
} satisfies ToolOutputProperty

export const OCI_STREAMING_STREAMS_OUTPUTS = {
  streams: {
    type: 'array',
    description: 'One page of streams.',
    items: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Resource OCID.',
        },
        name: {
          type: 'string',
          description: 'Resource name.',
        },
        compartmentId: {
          type: 'string',
          description: 'Containing compartment OCID.',
        },
        lifecycleState: {
          type: 'string',
          description:
            'Current lifecycle state; acceptance does not imply provisioning is complete.',
        },
        timeCreated: {
          type: 'string',
          description: 'Creation timestamp.',
        },
        freeformTags: {
          type: 'json',
          description: 'Dynamic freeform tag names and string values.',
          optional: true,
        },
        definedTags: {
          type: 'json',
          description: 'Dynamic tag namespaces and string-valued tag names.',
          optional: true,
        },
        streamPoolId: {
          type: 'string',
          description: 'Containing stream pool OCID.',
        },
        partitions: {
          type: 'number',
          description: 'Partition count.',
        },
        messagesEndpoint: {
          type: 'string',
          description:
            'Endpoint reported by Oracle; message tools rediscover it through authenticated GetStream.',
        },
      },
    },
  },
} satisfies Record<string, ToolOutputProperty>

export const OCI_STREAMING_STREAM_OUTPUTS = {
  stream: {
    type: 'json',
    description: 'Stream configuration.',
    properties: {
      id: {
        type: 'string',
        description: 'Resource OCID.',
      },
      name: {
        type: 'string',
        description: 'Resource name.',
      },
      compartmentId: {
        type: 'string',
        description: 'Containing compartment OCID.',
      },
      lifecycleState: {
        type: 'string',
        description: 'Current lifecycle state; acceptance does not imply provisioning is complete.',
      },
      timeCreated: {
        type: 'string',
        description: 'Creation timestamp.',
      },
      freeformTags: {
        type: 'json',
        description: 'Dynamic freeform tag names and string values.',
        optional: true,
      },
      definedTags: {
        type: 'json',
        description: 'Dynamic tag namespaces and string-valued tag names.',
        optional: true,
      },
      streamPoolId: {
        type: 'string',
        description: 'Containing stream pool OCID.',
      },
      partitions: {
        type: 'number',
        description: 'Partition count.',
      },
      messagesEndpoint: {
        type: 'string',
        description:
          'Endpoint reported by Oracle; message tools rediscover it through authenticated GetStream.',
      },
      retentionInHours: {
        type: 'number',
        description: 'Retention period in hours.',
      },
      lifecycleStateDetails: {
        type: 'string',
        description: 'Additional lifecycle details.',
        optional: true,
        nullable: true,
      },
    },
  },
} satisfies Record<string, ToolOutputProperty>

export const OCI_STREAMING_STREAM_POOLS_OUTPUTS = {
  streamPools: {
    type: 'array',
    description: 'One page of stream pools.',
    items: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Resource OCID.',
        },
        name: {
          type: 'string',
          description: 'Resource name.',
        },
        compartmentId: {
          type: 'string',
          description: 'Containing compartment OCID.',
        },
        lifecycleState: {
          type: 'string',
          description:
            'Current lifecycle state; acceptance does not imply provisioning is complete.',
        },
        timeCreated: {
          type: 'string',
          description: 'Creation timestamp.',
        },
        freeformTags: {
          type: 'json',
          description: 'Dynamic freeform tag names and string values.',
          optional: true,
        },
        definedTags: {
          type: 'json',
          description: 'Dynamic tag namespaces and string-valued tag names.',
          optional: true,
        },
        isPrivate: {
          type: 'boolean',
          description:
            'Whether the pool is private. Private message endpoints remain subject to the foundation egress restrictions.',
          optional: true,
          nullable: true,
        },
      },
    },
  },
} satisfies Record<string, ToolOutputProperty>

export const OCI_STREAMING_STREAM_POOL_OUTPUTS = {
  streamPool: {
    type: 'json',
    description: 'Stream pool configuration.',
    properties: {
      id: {
        type: 'string',
        description: 'Resource OCID.',
      },
      name: {
        type: 'string',
        description: 'Resource name.',
      },
      compartmentId: {
        type: 'string',
        description: 'Containing compartment OCID.',
      },
      lifecycleState: {
        type: 'string',
        description: 'Current lifecycle state; acceptance does not imply provisioning is complete.',
      },
      timeCreated: {
        type: 'string',
        description: 'Creation timestamp.',
      },
      freeformTags: {
        type: 'json',
        description: 'Dynamic freeform tag names and string values.',
        optional: true,
      },
      definedTags: {
        type: 'json',
        description: 'Dynamic tag namespaces and string-valued tag names.',
        optional: true,
      },
      isPrivate: {
        type: 'boolean',
        description:
          'Whether the pool is private. Private message endpoints remain subject to the foundation egress restrictions.',
        optional: true,
        nullable: true,
      },
      endpointFqdn: {
        type: 'string',
        description: 'Pool endpoint hostname reported by Oracle.',
        optional: true,
        nullable: true,
      },
      lifecycleStateDetails: {
        type: 'string',
        description: 'Additional lifecycle details.',
        optional: true,
        nullable: true,
      },
      kafkaSettings: {
        type: 'json',
        description:
          'Kafka compatibility configuration; no Kafka client or authentication is established.',
        properties: {
          autoCreateTopicsEnable: {
            type: 'boolean',
            description: 'Whether Kafka can automatically create topics.',
            optional: true,
            nullable: true,
          },
          bootstrapServers: {
            type: 'string',
            description: 'Kafka bootstrap servers, returned as metadata only.',
            optional: true,
            nullable: true,
          },
          logRetentionHours: {
            type: 'number',
            description: 'Kafka log retention hours.',
            optional: true,
          },
          numPartitions: {
            type: 'number',
            description: 'Default Kafka topic partition count.',
            optional: true,
          },
        },
      },
      customEncryptionKey: {
        type: 'json',
        description: 'Customer-managed encryption key settings.',
        properties: {
          kmsKeyId: {
            type: 'string',
            description: 'KMS key OCID.',
            optional: true,
            nullable: true,
          },
          keyState: {
            type: 'string',
            description: 'Encryption key lifecycle state.',
            optional: true,
            nullable: true,
          },
        },
      },
      privateEndpointSettings: {
        type: 'json',
        description: 'Read-only private endpoint configuration.',
        properties: {
          nsgIds: {
            type: 'array',
            description: 'Network security group OCIDs.',
            items: {
              type: 'string',
            },
            optional: true,
          },
          privateEndpointIp: {
            type: 'string',
            description: 'Private endpoint IP.',
            optional: true,
            nullable: true,
          },
          subnetId: {
            type: 'string',
            description: 'Subnet OCID.',
            optional: true,
            nullable: true,
          },
        },
        optional: true,
        nullable: true,
      },
    },
  },
} satisfies Record<string, ToolOutputProperty>

export const OCI_STREAMING_PUBLISH_OUTPUTS = {
  entries: {
    type: 'array',
    description:
      'Results in exactly the same order as input messages; successful entries are preserved on partial failure.',
    items: {
      type: 'object',
      properties: {
        error: {
          type: 'string',
          description: 'Failure code for this entry.',
          optional: true,
          nullable: true,
        },
        errorMessage: {
          type: 'string',
          description: 'Failure explanation for this entry.',
          optional: true,
          nullable: true,
        },
        offset: {
          type: 'string',
          description: 'Exact partition-local decimal offset for a successful entry.',
          optional: true,
          nullable: true,
        },
        partition: {
          type: 'string',
          description: 'Partition of a successful entry.',
          optional: true,
          nullable: true,
        },
        timestamp: {
          type: 'string',
          description: 'Append timestamp of a successful entry.',
          optional: true,
          nullable: true,
        },
      },
    },
  },
  failures: {
    type: 'number',
    description: 'Number of failed entries.',
  },
  allSucceeded: {
    type: 'boolean',
    description: 'True only when every message succeeded.',
  },
} satisfies Record<string, ToolOutputProperty>

export const OCI_STREAMING_CURSOR_OUTPUTS = {
  cursor: {
    type: 'string',
    description: 'Replacement opaque cursor; use it for the next read, commit, or heartbeat.',
  },
} satisfies Record<string, ToolOutputProperty>

export const OCI_STREAMING_MESSAGES_OUTPUTS = {
  messages: {
    type: 'array',
    description: 'One bounded batch; may be empty.',
    items: {
      type: 'object',
      properties: {
        stream: {
          type: 'string',
          description: 'Stream identifier as returned by Oracle.',
        },
        partition: {
          type: 'string',
          description: 'Partition identifier.',
        },
        key: {
          type: 'string',
          description: 'Base64 key, or null.',
          nullable: true,
        },
        value: {
          type: 'string',
          description: 'Base64 message value.',
        },
        offset: {
          type: 'string',
          description: 'Exact partition-local decimal offset.',
        },
        timestamp: {
          type: 'string',
          description: 'Append timestamp.',
        },
      },
    },
  },
  nextCursor: {
    type: 'string',
    description:
      'Next opaque message cursor, also returned for empty batches. Not an administrative page token.',
  },
} satisfies Record<string, ToolOutputProperty>

export const OCI_STREAMING_GROUP_OUTPUTS = {
  group: {
    type: 'json',
    description: 'Consumer group state.',
    properties: {
      streamId: {
        type: 'string',
        description: 'Stream OCID.',
      },
      groupName: {
        type: 'string',
        description: 'Consumer group name.',
      },
      reservations: {
        type: 'array',
        description: 'Current partition reservations.',
        items: {
          type: 'object',
          properties: {
            partition: {
              type: 'string',
              description: 'Reserved partition.',
              optional: true,
              nullable: true,
            },
            committedOffset: {
              type: 'string',
              description: 'Exact signed decimal committed offset.',
              optional: true,
              nullable: true,
            },
            reservedInstance: {
              type: 'string',
              description: 'Reserved consumer instance.',
              optional: true,
              nullable: true,
            },
            timeReservedUntil: {
              type: 'string',
              description: 'Reservation expiry.',
              optional: true,
              nullable: true,
            },
          },
        },
      },
    },
  },
} satisfies Record<string, ToolOutputProperty>

export const OCI_STREAMING_WORK_REQUESTS_OUTPUTS = {
  workRequests: {
    type: 'array',
    description: 'One page of work requests.',
    items: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Work request OCID.',
        },
        compartmentId: {
          type: 'string',
          description: 'Compartment OCID.',
        },
        operationType: {
          type: 'string',
          description: 'Tracked operation.',
        },
        status: {
          type: 'string',
          description: 'Asynchronous operation status.',
        },
        percentComplete: {
          type: 'number',
          description: 'Completion percentage.',
        },
        timeAccepted: {
          type: 'string',
          description: 'Acceptance timestamp.',
        },
        timeStarted: {
          type: 'string',
          description: 'Start timestamp.',
          optional: true,
          nullable: true,
        },
        timeFinished: {
          type: 'string',
          description: 'Finish timestamp.',
          optional: true,
          nullable: true,
        },
        resources: {
          type: 'array',
          description: 'Affected resources.',
          items: {
            type: 'object',
            properties: {
              actionType: {
                type: 'string',
                description: 'Effect on this resource.',
              },
              entityType: {
                type: 'string',
                description: 'Resource type.',
              },
              identifier: {
                type: 'string',
                description: 'Resource identifier.',
              },
              entityUri: {
                type: 'string',
                description: 'Resource URI returned as metadata; never followed automatically.',
                optional: true,
                nullable: true,
              },
            },
          },
        },
      },
    },
  },
} satisfies Record<string, ToolOutputProperty>

export const OCI_STREAMING_WORK_REQUEST_OUTPUTS = {
  workRequest: {
    type: 'json',
    description: 'Asynchronous work request.',
    properties: {
      id: {
        type: 'string',
        description: 'Work request OCID.',
      },
      compartmentId: {
        type: 'string',
        description: 'Compartment OCID.',
      },
      operationType: {
        type: 'string',
        description: 'Tracked operation.',
      },
      status: {
        type: 'string',
        description: 'Asynchronous operation status.',
      },
      percentComplete: {
        type: 'number',
        description: 'Completion percentage.',
      },
      timeAccepted: {
        type: 'string',
        description: 'Acceptance timestamp.',
      },
      timeStarted: {
        type: 'string',
        description: 'Start timestamp.',
        optional: true,
        nullable: true,
      },
      timeFinished: {
        type: 'string',
        description: 'Finish timestamp.',
        optional: true,
        nullable: true,
      },
      resources: {
        type: 'array',
        description: 'Affected resources.',
        items: {
          type: 'object',
          properties: {
            actionType: {
              type: 'string',
              description: 'Effect on this resource.',
            },
            entityType: {
              type: 'string',
              description: 'Resource type.',
            },
            identifier: {
              type: 'string',
              description: 'Resource identifier.',
            },
            entityUri: {
              type: 'string',
              description: 'Resource URI returned as metadata; never followed automatically.',
              optional: true,
              nullable: true,
            },
          },
        },
      },
    },
  },
} satisfies Record<string, ToolOutputProperty>

export const OCI_STREAMING_ERRORS_OUTPUTS = {
  errors: {
    type: 'array',
    description: 'One page of work request errors.',
    items: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Oracle error code.',
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
  },
} satisfies Record<string, ToolOutputProperty>

export const OCI_STREAMING_LOGS_OUTPUTS = {
  logs: {
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
  },
} satisfies Record<string, ToolOutputProperty>
