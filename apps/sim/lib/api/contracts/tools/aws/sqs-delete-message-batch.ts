import { z } from 'zod'
import {
  hasDistinctBatchEntryIds,
  SQS_DISTINCT_BATCH_ENTRY_IDS_MESSAGE,
  SQS_MAX_BATCH_ENTRIES,
  sqsBatchEntryIdSchema,
  sqsBatchResultErrorEntrySchema,
  sqsConnectionFields,
  sqsQueueUrlField,
} from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DeleteMessageBatchSchema = z.object({
  ...sqsConnectionFields,
  queueUrl: sqsQueueUrlField,
  entries: z
    .array(
      z.object({
        id: sqsBatchEntryIdSchema,
        receiptHandle: z.string().min(1, 'Receipt handle is required'),
      })
    )
    .min(1, 'At least one entry is required')
    .max(SQS_MAX_BATCH_ENTRIES, `A batch can hold at most ${SQS_MAX_BATCH_ENTRIES} entries`)
    .refine(hasDistinctBatchEntryIds, SQS_DISTINCT_BATCH_ENTRY_IDS_MESSAGE),
})

const DeleteMessageBatchResponseSchema = z.object({
  message: z.string(),
  successful: z.array(z.object({ id: z.string().nullable() })),
  failed: z.array(sqsBatchResultErrorEntrySchema),
  successCount: z.number(),
  failureCount: z.number(),
})

export const awsSqsDeleteMessageBatchContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/delete-message-batch',
  body: DeleteMessageBatchSchema,
  response: { mode: 'json', schema: DeleteMessageBatchResponseSchema },
})
export type AwsSqsDeleteMessageBatchRequest = ContractBodyInput<
  typeof awsSqsDeleteMessageBatchContract
>
export type AwsSqsDeleteMessageBatchBody = ContractBody<typeof awsSqsDeleteMessageBatchContract>
export type AwsSqsDeleteMessageBatchResponse = ContractJsonResponse<
  typeof awsSqsDeleteMessageBatchContract
>
