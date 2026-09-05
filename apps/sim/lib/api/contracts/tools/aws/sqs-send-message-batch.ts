import { z } from 'zod'
import {
  SQS_MAX_BATCH_ENTRIES,
  sqsBatchEntryIdSchema,
  sqsBatchResultErrorEntrySchema,
  sqsConnectionFields,
  sqsMessageAttributesInputSchema,
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
  messageGroupId: z.string().max(128, 'messageGroupId must be at most 128 characters').nullish(),
  messageDeduplicationId: z
    .string()
    .max(128, 'messageDeduplicationId must be at most 128 characters')
    .nullish(),
})

const SendMessageBatchSchema = z.object({
  ...sqsConnectionFields,
  queueUrl: sqsQueueUrlField,
  entries: z
    .array(SendMessageBatchEntrySchema)
    .min(1, 'At least one entry is required')
    .max(SQS_MAX_BATCH_ENTRIES, `A batch can hold at most ${SQS_MAX_BATCH_ENTRIES} entries`),
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
