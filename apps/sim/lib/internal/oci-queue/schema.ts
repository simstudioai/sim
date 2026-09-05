import { z } from 'zod'

/**
 * Oracle Queue 20210201: https://docs.oracle.com/en-us/iaas/api/#/en/queue/20210201/
 */
export const OCI_QUEUE_MAX_MESSAGE_BYTES = 256 * 1024
export const OCI_QUEUE_MAX_PUT_BYTES = 512 * 1024
export const OCI_QUEUE_MAX_BATCH_ENTRIES = 20

const identifier = z.string().trim().min(1).max(255)
const opaque = z.string().min(1)
const channel = z.string().min(1).max(64)
const visibility = z.number().int().min(0).max(43_200)
const timeout = z.number().int().min(0).max(30)
const auth = { oauthCredential: identifier, region: identifier.optional() }
const target = { ...auth, queueId: identifier }
const consumer = { ...target, consumerGroupId: identifier.optional() }
const paging = { page: opaque.optional(), limit: z.number().int().min(1).max(1000).optional() }
const ifMatch = z.string().min(1).optional()
const configuration = {
  displayName: z.string().min(1).max(255).optional(),
  visibilityInSeconds: visibility.min(1).optional(),
  timeoutInSeconds: timeout.optional(),
  deadLetterQueueDeliveryCount: z.number().int().min(0).max(20).optional(),
  channelConsumptionLimit: z.number().int().min(1).max(100).optional(),
  customEncryptionKeyId: z.string().max(255).optional(),
  freeformTags: z.record(z.string(), z.string()).optional(),
  definedTags: z
    .record(z.string(), z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])))
    .optional(),
}

export const ociQueueMessageMetadataSchema = z.object({
  channelId: channel,
  customProperties: z.record(z.string(), z.string()).optional(),
})

export const ociQueueInputSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('oci_queue_list_queues'),
    ...auth,
    ...paging,
    compartmentId: identifier.optional(),
    displayName: z.string().min(1).max(255).optional(),
    id: identifier.optional(),
    lifecycleState: z
      .enum(['CREATING', 'UPDATING', 'ACTIVE', 'DELETING', 'DELETED', 'FAILED', 'INACTIVE'])
      .optional(),
    sortBy: z.enum(['timeCreated', 'displayName']).optional(),
    sortOrder: z.enum(['ASC', 'DESC']).optional(),
  }),
  z.object({ operation: z.literal('oci_queue_get_queue'), ...target }),
  z.object({
    operation: z.literal('oci_queue_create_queue'),
    ...auth,
    ...configuration,
    displayName: z.string().min(1).max(255),
    compartmentId: identifier,
    customEncryptionKeyId: identifier.optional(),
    retentionInSeconds: z.number().int().min(10).max(604_800).optional(),
    retryToken: z.string().min(1).max(64).optional(),
  }),
  z.object({
    operation: z.literal('oci_queue_update_queue'),
    ...target,
    ...configuration,
    ifMatch,
  }),
  z.object({ operation: z.literal('oci_queue_delete_queue'), ...target, ifMatch }),
  z.object({
    operation: z.literal('oci_queue_change_queue_compartment'),
    ...target,
    destinationCompartmentId: identifier,
    ifMatch,
  }),
  z.object({
    operation: z.literal('oci_queue_purge_queue'),
    ...consumer,
    purgeType: z.enum(['NORMAL', 'DLQ', 'BOTH']),
    channelIds: z.array(channel).min(1).max(256).optional(),
    ifMatch,
  }),
  z.object({
    operation: z.literal('oci_queue_put_messages'),
    ...target,
    messages: z
      .array(z.object({ content: z.string(), metadata: ociQueueMessageMetadataSchema.optional() }))
      .min(1)
      .max(OCI_QUEUE_MAX_BATCH_ENTRIES),
  }),
  z.object({
    operation: z.literal('oci_queue_get_messages'),
    ...consumer,
    visibilityInSeconds: visibility.optional(),
    timeoutInSeconds: timeout.optional(),
    limit: z.number().int().min(1).max(20).optional(),
    channelFilter: channel.optional(),
  }),
  z.object({
    operation: z.literal('oci_queue_delete_message'),
    ...consumer,
    messageReceipt: opaque,
  }),
  z.object({
    operation: z.literal('oci_queue_delete_messages'),
    ...consumer,
    entries: z
      .array(z.object({ receipt: opaque }))
      .min(1)
      .max(OCI_QUEUE_MAX_BATCH_ENTRIES),
  }),
  z.object({
    operation: z.literal('oci_queue_update_message'),
    ...consumer,
    messageReceipt: opaque,
    visibilityInSeconds: visibility,
  }),
  z.object({
    operation: z.literal('oci_queue_update_messages'),
    ...consumer,
    entries: z
      .array(z.object({ receipt: opaque, visibilityInSeconds: visibility }))
      .min(1)
      .max(OCI_QUEUE_MAX_BATCH_ENTRIES),
  }),
  z.object({
    operation: z.literal('oci_queue_get_stats'),
    ...consumer,
    channelId: channel.optional(),
  }),
  z.object({
    operation: z.literal('oci_queue_list_channels'),
    ...consumer,
    ...paging,
    channelFilter: channel.optional(),
  }),
  z.object({
    operation: z.literal('oci_queue_list_work_requests'),
    ...auth,
    ...paging,
    compartmentId: identifier.optional(),
    workRequestId: identifier.optional(),
  }),
  z.object({
    operation: z.literal('oci_queue_get_work_request'),
    ...auth,
    workRequestId: identifier,
  }),
  z.object({
    operation: z.literal('oci_queue_list_work_request_errors'),
    ...auth,
    ...paging,
    workRequestId: identifier,
  }),
  z.object({
    operation: z.literal('oci_queue_list_work_request_logs'),
    ...auth,
    ...paging,
    workRequestId: identifier,
  }),
])

export type OciQueueInput = z.infer<typeof ociQueueInputSchema>

const tags = z.record(z.string(), z.record(z.string(), z.unknown())).optional()
export const ociQueueSummarySchema = z.object({
  id: z.string(),
  compartmentId: z.string(),
  displayName: z.string().optional(),
  lifecycleState: z.string(),
  lifecycleDetails: z.string().optional(),
  timeCreated: z.string(),
  timeUpdated: z.string(),
  messagesEndpoint: z.string(),
  capabilities: z.array(z.string()).optional(),
  freeformTags: z.record(z.string(), z.string()).optional(),
  definedTags: tags,
  systemTags: tags,
})

export const ociQueueSchema = ociQueueSummarySchema.extend({
  capabilities: z.array(z.object({ type: z.string() })).optional(),
  retentionInSeconds: z.number().int(),
  visibilityInSeconds: z.number().int(),
  timeoutInSeconds: z.number().int(),
  deadLetterQueueDeliveryCount: z.number().int(),
  channelConsumptionLimit: z.number().int().optional(),
  customEncryptionKeyId: z.string().optional(),
})

const messageId = z.string().regex(/^-?\d+$/)
export const ociQueuePublishedMessageSchema = z.object({
  id: messageId,
  expireAfter: z.string().optional(),
})
export const ociQueueReceivedMessageSchema = ociQueuePublishedMessageSchema.extend({
  content: z.string(),
  receipt: z.string(),
  deliveryCount: z.number().int(),
  createdAt: z.string(),
  visibleAfter: z.string(),
  expireAfter: z.string(),
  metadata: ociQueueMessageMetadataSchema.optional(),
})
export const ociQueueUpdatedMessageSchema = z.object({ id: messageId, visibleAfter: z.string() })
export const ociQueueBatchEntrySchema = z.object({
  errorCode: z.number().int().optional(),
  errorMessage: z.string().optional(),
  id: messageId.optional(),
  visibleAfter: z.string().optional(),
})
const stats = z.object({
  visibleMessages: z.number().int().nonnegative().safe(),
  inFlightMessages: z.number().int().nonnegative().safe(),
  sizeInBytes: z.number().int().nonnegative().safe(),
})
export const ociQueueStatsSchema = z.object({
  queue: stats,
  dlq: stats,
  channelId: z.string().optional(),
  consumerGroupId: z.string().optional(),
})
export const ociQueueWorkRequestSchema = z.object({
  id: z.string(),
  operationType: z.string(),
  status: z.string(),
  compartmentId: z.string(),
  percentComplete: z.number(),
  timeAccepted: z.string(),
  timeStarted: z.string().optional(),
  timeFinished: z.string().optional(),
  resources: z.array(
    z.object({
      actionType: z.string(),
      entityType: z.string(),
      identifier: z.string(),
      entityUri: z.string().optional(),
    })
  ),
})
