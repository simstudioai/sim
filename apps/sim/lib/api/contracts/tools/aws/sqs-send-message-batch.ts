import { z } from 'zod'
import {
  hasDistinctBatchEntryIds,
  SQS_DISTINCT_BATCH_ENTRY_IDS_MESSAGE,
  SQS_MAX_BATCH_ENTRIES,
  sqsBatchEntryIdSchema,
  sqsBatchResultErrorEntrySchema,
  sqsConnectionFields,
  sqsMessageAttributesInputSchema,
  sqsMessageDeduplicationIdField,
  sqsMessageGroupIdField,
  sqsQueueUrlField,
} from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const SendMessageBatchEntrySchema = z.object({
  id: sqsBatchEntryIdSchema,
  data: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, {
    message: 'Each entry data object must have at least one field',
  }),
  delaySeconds: z
    .number()
    .int()
    .min(0, 'delaySeconds must be at least 0')
    .max(900, 'delaySeconds cannot exceed 900')
    .nullish(),
  messageAttributes: sqsMessageAttributesInputSchema.nullish(),
  messageGroupId: sqsMessageGroupIdField.nullish(),
  messageDeduplicationId: sqsMessageDeduplicationIdField.nullish(),
})

const SendMessageBatchSchema = z.object({
  ...sqsConnectionFields,
  queueUrl: sqsQueueUrlField,
  entries: z
    .array(SendMessageBatchEntrySchema)
    .min(1, 'At least one entry is required')
    .max(SQS_MAX_BATCH_ENTRIES, `A batch can hold at most ${SQS_MAX_BATCH_ENTRIES} entries`)
    .refine(hasDistinctBatchEntryIds, SQS_DISTINCT_BATCH_ENTRY_IDS_MESSAGE),
})

const SendMessageBatchResponseSchema = z.object({
  message: z.string(),
  successful: z.array(
    z.object({
      id: z.string().nullable(),
      messageId: z.string().nullable(),
      md5OfMessageBody: z.string().nullable(),
      md5OfMessageAttributes: z.string().nullable(),
      sequenceNumber: z.string().nullable(),
    })
  ),
  failed: z.array(sqsBatchResultErrorEntrySchema),
  successCount: z.number(),
  failureCount: z.number(),
})

export const awsSqsSendMessageBatchContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/send-message-batch',
  body: SendMessageBatchSchema,
  response: { mode: 'json', schema: SendMessageBatchResponseSchema },
})
export type AwsSqsSendMessageBatchRequest = ContractBodyInput<typeof awsSqsSendMessageBatchContract>
export type AwsSqsSendMessageBatchBody = ContractBody<typeof awsSqsSendMessageBatchContract>
export type AwsSqsSendMessageBatchResponse = ContractJsonResponse<
  typeof awsSqsSendMessageBatchContract
>
