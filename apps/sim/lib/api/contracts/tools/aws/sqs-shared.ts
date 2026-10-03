import { z } from 'zod'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

/**
 * Connection fields every Amazon SQS tool contract requires. Spread into each
 * operation's body schema so the credential shape stays identical across all of them.
 */
export const sqsConnectionFields = {
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((value) => validateAwsRegion(value).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
}

/** `QueueUrl`, required by every action that targets an existing queue. */
export const sqsQueueUrlField = z.string().min(1, 'Queue URL is required')

/**
 * `QueueName`, required by CreateQueue and GetQueueUrl. Documented as up to 80
 * characters of alphanumerics, hyphens, and underscores; a FIFO queue name ends
 * with the `.fifo` suffix.
 */
export const sqsQueueNameField = z
  .string()
  .min(1, 'Queue name is required')
  .max(80, 'Queue name must be at most 80 characters')
  .regex(
    /^[A-Za-z0-9_-]+(\.fifo)?$/,
    'Queue name may only contain letters, digits, hyphens, and underscores, optionally ending in .fifo'
  )

/**
 * A queue ARN, in the documented `arn:<partition>:sqs:<region>:<account-id>:<queue-name>`
 * form used by the message move task actions.
 */
export const sqsQueueArnSchema = z
  .string()
  .regex(
    /^arn:[a-z0-9-]+:sqs:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]+(\.fifo)?$/,
    'Must be a queue ARN (e.g., arn:aws:sqs:us-east-1:123456789012:my-queue)'
  )

/** A 12-digit AWS account ID. */
export const sqsAwsAccountIdSchema = z
  .string()
  .regex(/^\d{12}$/, 'AWS account ID must be 12 digits')

/**
 * `Id` of a batch request entry. Documented as up to 80 characters of
 * alphanumerics, hyphens, and underscores, unique within the request.
 */
export const sqsBatchEntryIdSchema = z
  .string()
  .min(1, 'Batch entry id is required')
  .max(80, 'Batch entry id must be at most 80 characters')
  .regex(
    /^[A-Za-z0-9_-]+$/,
    'Batch entry id may only contain letters, digits, hyphens, underscores'
  )

/**
 * The documented batch size for SendMessageBatch, DeleteMessageBatch, and
 * ChangeMessageVisibilityBatch. AWS states the limit in the
 * `TooManyEntriesInBatchRequest` error rather than on the `Entries` parameter.
 */
export const SQS_MAX_BATCH_ENTRIES = 10

/**
 * AWS rejects a batch whose entries reuse an `Id` with `BatchEntryIdsNotDistinct`
 * ("Two or more batch entries in the request have the same `Id`"), failing the
 * whole request rather than the offending entry. Every batch contract refines its
 * `entries` array with this so the caller gets a local field error instead of
 * losing the batch at the provider.
 */
export function hasDistinctBatchEntryIds(entries: readonly { id: string }[]) {
  return new Set(entries.map((entry) => entry.id)).size === entries.length
}

/** Message reported when {@link hasDistinctBatchEntryIds} rejects a batch. */
export const SQS_DISTINCT_BATCH_ENTRY_IDS_MESSAGE =
  'Batch entry ids must be unique within a request'

/**
 * `QueueAttributeName` values AWS documents as settable, taken from the "special
 * request parameters that the action uses" list shared by CreateQueue and
 * SetQueueAttributes.
 *
 * The read-only names carried by the shared `Valid Keys` enum
 * (`ApproximateNumberOfMessages`, `ApproximateNumberOfMessagesDelayed`,
 * `ApproximateNumberOfMessagesNotVisible`, `CreatedTimestamp`,
 * `LastModifiedTimestamp`, `QueueArn`) and the `All` pseudo-name are deliberately
 * absent: neither action documents them as settable, and AWS answers a write with
 * `InvalidAttributeName`.
 */
const sqsSettableQueueAttributeNames = [
  'ContentBasedDeduplication',
  'DeduplicationScope',
  'DelaySeconds',
  'FifoThroughputLimit',
  'KmsDataKeyReusePeriodSeconds',
  'KmsMasterKeyId',
  'MaximumMessageSize',
  'MessageRetentionPeriod',
  'Policy',
  'ReceiveMessageWaitTimeSeconds',
  'RedriveAllowPolicy',
  'RedrivePolicy',
  'SqsManagedSseEnabled',
  'VisibilityTimeout',
] as const

/**
 * Attribute names CreateQueue accepts. `FifoQueue` is create-only, because AWS
 * documents that "You can provide this attribute only during queue creation. You
 * can't change it for an existing queue."
 */
export const sqsCreateQueueAttributeNameSchema = z.enum([
  ...sqsSettableQueueAttributeNames,
  'FifoQueue',
])

/** Attribute names SetQueueAttributes accepts, which excludes create-only `FifoQueue`. */
export const sqsSetQueueAttributeNameSchema = z.enum(sqsSettableQueueAttributeNames)

/** Documented `QueueAttributeName` values, including the read-only `All` pseudo-name. */
export const sqsQueueAttributeNameSchema = z.enum([
  'All',
  'ApproximateNumberOfMessages',
  'ApproximateNumberOfMessagesDelayed',
  'ApproximateNumberOfMessagesNotVisible',
  'ContentBasedDeduplication',
  'CreatedTimestamp',
  'DeduplicationScope',
  'DelaySeconds',
  'FifoQueue',
  'FifoThroughputLimit',
  'KmsDataKeyReusePeriodSeconds',
  'KmsMasterKeyId',
  'LastModifiedTimestamp',
  'MaximumMessageSize',
  'MessageRetentionPeriod',
  'Policy',
  'QueueArn',
  'ReceiveMessageWaitTimeSeconds',
  'RedriveAllowPolicy',
  'RedrivePolicy',
  'SqsManagedSseEnabled',
  'VisibilityTimeout',
])

/** Documented `MessageSystemAttributeName` values accepted by ReceiveMessage. */
export const sqsMessageSystemAttributeNameSchema = z.enum([
  'All',
  'ApproximateFirstReceiveTimestamp',
  'ApproximateReceiveCount',
  'AWSTraceHeader',
  'DeadLetterQueueSourceArn',
  'MessageDeduplicationId',
  'MessageGroupId',
  'SenderId',
  'SentTimestamp',
  'SequenceNumber',
])

/** Attribute map accepted by CreateQueue, which alone may set `FifoQueue`. */
export const sqsCreateQueueAttributesSchema = z.partialRecord(
  sqsCreateQueueAttributeNameSchema,
  z.string({ error: 'Queue attribute values must be strings' })
)

/** Attribute map accepted by SetQueueAttributes. */
export const sqsSetQueueAttributesSchema = z.partialRecord(
  sqsSetQueueAttributeNameSchema,
  z.string({ error: 'Queue attribute values must be strings' })
)

/**
 * `MessageGroupId` and `MessageDeduplicationId` are FIFO tokens documented as up
 * to 128 characters of alphanumerics and punctuation. Both operations forward the
 * value verbatim, so an empty string reaches SQS as a malformed token; the block
 * already drops a blank field before mapping, so only an explicitly empty string
 * is refused here.
 */
const sqsFifoTokenField = (fieldName: string) =>
  z
    .string()
    .min(1, `${fieldName} cannot be empty`)
    .max(128, `${fieldName} must be at most 128 characters`)

/** `MessageGroupId`, shared by SendMessage and each SendMessageBatch entry. */
export const sqsMessageGroupIdField = sqsFifoTokenField('messageGroupId')

/** `MessageDeduplicationId`, shared by SendMessage and each SendMessageBatch entry. */
export const sqsMessageDeduplicationIdField = sqsFifoTokenField('messageDeduplicationId')

/**
 * The documented cap on user-supplied message attributes: "Each message can have
 * up to 10 attributes."
 */
export const SQS_MAX_MESSAGE_ATTRIBUTES = 10

/**
 * User-supplied message attributes. Only the string-valued data types are
 * accepted: a `Binary` attribute needs a `BinaryValue` byte array, which cannot
 * cross the JSON tool boundary. AWS allows a custom label suffix on the logical
 * type, e.g. `Number.float`.
 */
export const sqsMessageAttributesInputSchema = z
  .record(
    z.string().min(1, 'Message attribute name is required'),
    z.object({
      dataType: z
        .string()
        .min(1, 'Message attribute dataType is required')
        .regex(
          /^(String|Number)(\.[\w.-]+)?$/,
          'Message attribute dataType must be String or Number, optionally with a custom label such as Number.float. Binary attributes are not supported.'
        ),
      stringValue: z.string().min(1, 'Message attribute stringValue is required'),
    })
  )
  .refine(
    (value) => Object.keys(value).length <= SQS_MAX_MESSAGE_ATTRIBUTES,
    `A message can have at most ${SQS_MAX_MESSAGE_ATTRIBUTES} message attributes`
  )

/** Message attributes as projected from a received message. */
export const sqsMessageAttributesOutputSchema = z.record(
  z.string(),
  z.object({
    dataType: z.string().nullable(),
    stringValue: z.string().nullable(),
    stringListValues: z.array(z.string()),
  })
)

/** `BatchResultErrorEntry`, identical across all three SQS batch actions. */
export const sqsBatchResultErrorEntrySchema = z.object({
  id: z.string().nullable(),
  senderFault: z.boolean().nullable(),
  code: z.string().nullable(),
  message: z.string().nullable(),
})

/** Tag keys and values applied to a queue. */
export const sqsTagsSchema = z.record(
  z.string().min(1, 'Tag key is required').max(128, 'Tag key must be at most 128 characters'),
  z.string().max(256, 'Tag value must be at most 256 characters')
)
