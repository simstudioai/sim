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
 * Documented `QueueAttributeName` values that CreateQueue and SetQueueAttributes
 * accept. `All` is deliberately absent: it is a read-only pseudo-name meaning
 * "return every attribute", and AWS rejects it on a write with
 * `InvalidAttributeName`.
 */
export const sqsWritableQueueAttributeNameSchema = z.enum([
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

/** A settable queue attribute map, keyed by the attribute names AWS accepts on a write. */
export const sqsQueueAttributesSchema = z.partialRecord(
  sqsWritableQueueAttributeNameSchema,
  z.string({ error: 'Queue attribute values must be strings' })
)

/**
 * User-supplied message attributes. Only the string-valued data types are
 * accepted: a `Binary` attribute needs a `BinaryValue` byte array, which cannot
 * cross the JSON tool boundary. AWS allows a custom label suffix on the logical
 * type, e.g. `Number.float`.
 */
export const sqsMessageAttributesInputSchema = z.record(
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
