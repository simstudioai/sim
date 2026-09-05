import { z } from 'zod'
import {
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

const ChangeMessageVisibilityBatchSchema = z.object({
  ...sqsConnectionFields,
  queueUrl: sqsQueueUrlField,
  entries: z
    .array(
      z.object({
        id: sqsBatchEntryIdSchema,
        receiptHandle: z.string().min(1, 'Receipt handle is required'),
        visibilityTimeout: z
          .number()
          .int()
          .min(0, 'visibilityTimeout must be at least 0')
          .max(43200, 'visibilityTimeout cannot exceed 43200 seconds (12 hours)')
          .nullish(),
      })
    )
    .min(1, 'At least one entry is required')
    .max(SQS_MAX_BATCH_ENTRIES, `A batch can hold at most ${SQS_MAX_BATCH_ENTRIES} entries`),
})

const ChangeMessageVisibilityBatchResponseSchema = z.object({
  message: z.string(),
  successful: z.array(z.object({ id: z.string().nullable() })),
  failed: z.array(sqsBatchResultErrorEntrySchema),
  successCount: z.number(),
  failureCount: z.number(),
})

export const awsSqsChangeMessageVisibilityBatchContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/change-message-visibility-batch',
  body: ChangeMessageVisibilityBatchSchema,
  response: { mode: 'json', schema: ChangeMessageVisibilityBatchResponseSchema },
})
export type AwsSqsChangeMessageVisibilityBatchRequest = ContractBodyInput<
  typeof awsSqsChangeMessageVisibilityBatchContract
>
export type AwsSqsChangeMessageVisibilityBatchBody = ContractBody<
  typeof awsSqsChangeMessageVisibilityBatchContract
>
export type AwsSqsChangeMessageVisibilityBatchResponse = ContractJsonResponse<
  typeof awsSqsChangeMessageVisibilityBatchContract
>
