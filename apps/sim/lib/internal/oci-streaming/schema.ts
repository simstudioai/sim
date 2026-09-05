import { z } from 'zod'

const identifier = z.string().trim().min(1).max(1024)
const name = z.string().min(1).max(1024)
const groupName = z.string().min(1).max(255)
const timestamp = z.string().datetime({ offset: true })
const int32 = z.number().int().min(1).max(2_147_483_647)
const lifecycle = z.enum(['CREATING', 'ACTIVE', 'DELETING', 'DELETED', 'FAILED', 'UPDATING'])
/**
 * Bounds the tag shape before Zod clones records. OCI allows 10 free-form tags,
 * 64 defined tags, and 5 KiB of combined UTF-8 JSON tag data per resource.
 */
function boundedTags(value: unknown, defined: boolean): boolean {
  const isRecord = (entry: unknown): entry is Record<string, unknown> =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry)
  const validKey = (key: string) => key.length <= 100 && /^[\x21-\x2d\x2f-\x7e]+$/.test(key)
  const validValue = (entry: unknown) =>
    typeof entry === 'string' && entry.length <= 512 && [...entry].length <= 256
  if (!isRecord(value)) return false
  let containers = 0
  let entries = 0
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue
    if (++containers > (defined ? 64 : 10) || !validKey(key)) return false
    if (!defined) {
      if (!validValue(value[key])) return false
      continue
    }
    const namespace = value[key]
    if (!isRecord(namespace)) return false
    for (const tag in namespace) {
      if (!Object.hasOwn(namespace, tag)) continue
      if (++entries > 64 || !validKey(tag) || !validValue(namespace[tag])) return false
    }
  }
  return true
}

const responseTags = {
  freeformTags: z.record(z.string(), z.string()).optional(),
  definedTags: z.record(z.string(), z.record(z.string(), z.string())).optional(),
}
const tags = {
  freeformTags: z
    .custom<Record<string, string>>(
      (value) => boundedTags(value, false),
      'Free-form tags allow at most 10 entries, 100-character keys, and 256-character values'
    )
    .pipe(z.record(z.string(), z.string()))
    .optional(),
  definedTags: z
    .custom<Record<string, Record<string, string>>>(
      (value) => boundedTags(value, true),
      'Defined tags allow at most 64 tags and namespaces, 100-character names, and 256-character values'
    )
    .pipe(z.record(z.string(), z.record(z.string(), z.string())))
    .optional(),
}
const kafkaSettings = z
  .object({
    autoCreateTopicsEnable: z.boolean().optional(),
    logRetentionHours: z.number().int().min(1).max(672).optional(),
    numPartitions: int32.optional(),
  })
  .strict()
const poolFields = {
  ...tags,
  customEncryptionKeyDetails: z.object({ kmsKeyId: identifier }).strict().optional(),
  kafkaSettings: kafkaSettings.optional(),
}
const base = {
  ociCredential: identifier,
  ociRegion: z.string().trim().min(1).max(64).optional(),
  requestId: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[\x20-\x7e]+$/)
    .optional(),
}
const page = {
  limit: z.number().int().min(1).max(50).default(10),
  page: z.string().min(1).max(1024).optional(),
}
const list = {
  ...page,
  id: identifier.optional(),
  name: name.optional(),
  lifecycleState: lifecycle.optional(),
  sortBy: z.enum(['NAME', 'TIMECREATED']).optional(),
  sortOrder: z.enum(['ASC', 'DESC']).optional(),
}
const stream = { streamId: identifier }
const pool = { streamPoolId: identifier }
const ifMatch = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[\x20-\x7e]+$/)
  .optional()
const cursor = z.string().min(1).max(16_384)
const groupType = z.enum(['AT_TIME', 'LATEST', 'TRIM_HORIZON'])
const position = { type: groupType, time: timestamp.optional() }
const workRequest = { workRequestId: identifier }

export const offsetSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(19)
  .refine(
    (value) =>
      /^(0|[1-9][0-9]*)$/.test(value) &&
      value.length <= 19 &&
      BigInt(value) <= 9_223_372_036_854_775_807n,
    'Offset must be a non-negative signed 64-bit decimal integer'
  )
const signedOffset = z
  .string()
  .regex(/^-?(0|[1-9][0-9]*)$/)
  .max(20)
  .refine(
    (value) =>
      /^-?(0|[1-9][0-9]*)$/.test(value) &&
      value.length <= 20 &&
      BigInt(value) >= -9_223_372_036_854_775_808n &&
      BigInt(value) <= 9_223_372_036_854_775_807n
  )

export const ociStreamingInputSchema = z
  .discriminatedUnion('operation', [
    z
      .object({
        ...base,
        operation: z.literal('list_streams'),
        ...list,
        compartmentId: identifier.optional(),
        streamPoolId: identifier.optional(),
      })
      .strict(),
    z.object({ ...base, operation: z.literal('get_stream'), ...stream }).strict(),
    z
      .object({
        ...base,
        operation: z.literal('create_stream'),
        name,
        partitions: int32,
        compartmentId: identifier.optional(),
        streamPoolId: identifier.optional(),
        retentionInHours: z.number().int().min(24).max(168).optional(),
        ...tags,
      })
      .strict(),
    z
      .object({
        ...base,
        operation: z.literal('update_stream'),
        ...stream,
        streamPoolId: identifier.optional(),
        ...tags,
        ifMatch,
      })
      .strict(),
    z.object({ ...base, operation: z.literal('delete_stream'), ...stream, ifMatch }).strict(),
    z
      .object({
        ...base,
        operation: z.literal('change_stream_compartment'),
        ...stream,
        compartmentId: identifier,
        ifMatch,
      })
      .strict(),
    z
      .object({
        ...base,
        operation: z.literal('list_stream_pools'),
        ...list,
        compartmentId: identifier,
      })
      .strict(),
    z.object({ ...base, operation: z.literal('get_stream_pool'), ...pool }).strict(),
    z
      .object({
        ...base,
        operation: z.literal('create_stream_pool'),
        name,
        compartmentId: identifier,
        ...poolFields,
        retryToken: z
          .string()
          .min(1)
          .max(255)
          .regex(/^[\x21-\x7e]+$/)
          .optional(),
      })
      .strict(),
    z
      .object({
        ...base,
        operation: z.literal('update_stream_pool'),
        ...pool,
        name: name.optional(),
        ...poolFields,
        ifMatch,
      })
      .strict(),
    z.object({ ...base, operation: z.literal('delete_stream_pool'), ...pool, ifMatch }).strict(),
    z
      .object({
        ...base,
        operation: z.literal('change_stream_pool_compartment'),
        ...pool,
        compartmentId: identifier,
        ifMatch,
      })
      .strict(),
    z
      .object({
        ...base,
        operation: z.literal('put_messages'),
        ...stream,
        encoding: z.enum(['utf-8', 'base64']).default('utf-8'),
        messages: z
          .array(
            z
              .object({
                key: z.string().max(2048).nullable().optional(),
                value: z.string().min(1).max(1_398_104),
              })
              .strict()
          )
          .min(1)
          .max(1000),
      })
      .strict(),
    z
      .object({
        ...base,
        operation: z.literal('create_cursor'),
        ...stream,
        partition: z
          .string()
          .regex(/^(0|[1-9][0-9]*)$/)
          .max(10),
        type: z.enum(['AFTER_OFFSET', 'AT_OFFSET', 'AT_TIME', 'LATEST', 'TRIM_HORIZON']),
        offset: offsetSchema.optional(),
        time: timestamp.optional(),
      })
      .strict(),
    z
      .object({
        ...base,
        operation: z.literal('create_group_cursor'),
        ...stream,
        groupName,
        ...position,
        instanceName: groupName.optional(),
        timeoutInMs: int32.min(5000).optional(),
        commitOnGet: z.boolean().default(false),
      })
      .strict(),
    z
      .object({
        ...base,
        operation: z.literal('get_messages'),
        ...stream,
        cursor,
        limit: z.number().int().min(1).max(1000).default(100),
      })
      .strict(),
    z.object({ ...base, operation: z.literal('get_group'), ...stream, groupName }).strict(),
    z
      .object({ ...base, operation: z.literal('update_group'), ...stream, groupName, ...position })
      .strict(),
    z.object({ ...base, operation: z.literal('consumer_commit'), ...stream, cursor }).strict(),
    z.object({ ...base, operation: z.literal('consumer_heartbeat'), ...stream, cursor }).strict(),
    z
      .object({
        ...base,
        operation: z.literal('list_work_requests'),
        ...page,
        compartmentId: identifier,
        workRequestId: identifier.optional(),
        resourceId: identifier.optional(),
        sortBy: z.literal('TIMEACCEPTED').optional(),
        sortOrder: z.enum(['ASC', 'DESC']).optional(),
      })
      .strict(),
    z.object({ ...base, operation: z.literal('get_work_request'), ...workRequest }).strict(),
    z
      .object({
        ...base,
        operation: z.literal('list_work_request_errors'),
        ...workRequest,
        ...page,
      })
      .strict(),
    z
      .object({ ...base, operation: z.literal('list_work_request_logs'), ...workRequest, ...page })
      .strict(),
  ])
  .superRefine((input, context) => {
    if ('freeformTags' in input || 'definedTags' in input) {
      const tagData = { freeformTags: input.freeformTags, definedTags: input.definedTags }
      if (Buffer.byteLength(JSON.stringify(tagData), 'utf8') > 5 * 1024) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Combined tag data must not exceed 5 KiB of UTF-8 JSON',
        })
      }
    }
    if (input.operation === 'list_streams' || input.operation === 'create_stream') {
      if (Boolean(input.compartmentId) === Boolean(input.streamPoolId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['compartmentId'],
          message: 'Supply exactly one of compartmentId or streamPoolId',
        })
      }
    }
    if (
      input.operation === 'create_cursor' ||
      input.operation === 'create_group_cursor' ||
      input.operation === 'update_group'
    ) {
      if ((input.type === 'AT_TIME') !== (input.time !== undefined)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['time'],
          message: 'Supply time only for AT_TIME, where it is required',
        })
      }
      if (
        input.operation === 'create_cursor' &&
        (input.type === 'AT_OFFSET' || input.type === 'AFTER_OFFSET') !==
          (input.offset !== undefined)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['offset'],
          message: 'Supply offset only for AT_OFFSET or AFTER_OFFSET, where it is required',
        })
      }
    }
    if (
      input.operation === 'update_stream' &&
      input.streamPoolId === undefined &&
      input.freeformTags === undefined &&
      input.definedTags === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Supply at least one stream update field',
      })
    }
    if (
      input.operation === 'update_stream_pool' &&
      input.name === undefined &&
      input.freeformTags === undefined &&
      input.definedTags === undefined &&
      input.kafkaSettings === undefined &&
      input.customEncryptionKeyDetails === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Supply at least one stream pool update field',
      })
    }
  })

export type OciStreamingInput = z.infer<typeof ociStreamingInputSchema>

const resource = {
  id: z.string(),
  name: z.string(),
  compartmentId: z.string(),
  lifecycleState: z.string(),
  timeCreated: z.string(),
  ...responseTags,
}
export const streamSummarySchema = z.object({
  ...resource,
  streamPoolId: z.string(),
  partitions: z.number().int(),
  messagesEndpoint: z.string(),
})
export const streamSchema = streamSummarySchema.extend({
  retentionInHours: z.number().int(),
  lifecycleStateDetails: z.string().nullish(),
})
export const streamPoolSummarySchema = z.object({ ...resource, isPrivate: z.boolean().nullish() })
export const streamPoolSchema = streamPoolSummarySchema.extend({
  endpointFqdn: z.string().nullish(),
  lifecycleStateDetails: z.string().nullish(),
  kafkaSettings: kafkaSettings.strip().extend({ bootstrapServers: z.string().optional() }),
  customEncryptionKey: z.object({
    kmsKeyId: z.string().optional(),
    keyState: z.string().optional(),
  }),
  privateEndpointSettings: z
    .object({
      nsgIds: z.array(z.string()).optional(),
      privateEndpointIp: z.string().optional(),
      subnetId: z.string().optional(),
    })
    .nullish(),
})
export const cursorResponseSchema = z.object({ value: z.string().min(1) })
export const messageSchema = z.object({
  stream: z.string(),
  partition: z.string(),
  key: z.string().nullable(),
  value: z.string(),
  offset: offsetSchema,
  timestamp: z.string(),
})
export const publishResponseSchema = z.object({
  failures: z.number().int().min(0),
  entries: z.array(
    z.object({
      error: z.string().nullish(),
      errorMessage: z.string().nullish(),
      offset: offsetSchema.nullish(),
      partition: z.string().nullish(),
      timestamp: z.string().nullish(),
    })
  ),
})
export const groupSchema = z.object({
  streamId: z.string(),
  groupName: z.string(),
  reservations: z
    .array(
      z.object({
        partition: z.string().optional(),
        committedOffset: signedOffset.optional(),
        reservedInstance: z.string().nullish(),
        timeReservedUntil: z.string().nullish(),
      })
    )
    .default([]),
})
export const workRequestSchema = z.object({
  id: z.string(),
  compartmentId: z.string(),
  operationType: z.string(),
  status: z.string(),
  percentComplete: z.number(),
  timeAccepted: z.string(),
  timeStarted: z.string().nullish(),
  timeFinished: z.string().nullish(),
  resources: z.array(
    z.object({
      actionType: z.string(),
      entityType: z.string(),
      identifier: z.string(),
      entityUri: z.string().optional(),
    })
  ),
})
export const workRequestErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  timestamp: z.string(),
})
export const workRequestLogSchema = z.object({ message: z.string(), timestamp: z.string() })
