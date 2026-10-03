import { z } from 'zod'
import { sqsConnectionFields, sqsQueueUrlField } from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ChangeMessageVisibilitySchema = z.object({
  ...sqsConnectionFields,
  queueUrl: sqsQueueUrlField,
  receiptHandle: z.string().min(1, 'Receipt handle is required'),
  visibilityTimeout: z
    .number()
    .int()
    .min(0, 'visibilityTimeout must be at least 0')
    .max(43200, 'visibilityTimeout cannot exceed 43200 seconds (12 hours)'),
})

const ChangeMessageVisibilityResponseSchema = z.object({
  message: z.string(),
})

export const awsSqsChangeMessageVisibilityContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/change-message-visibility',
  body: ChangeMessageVisibilitySchema,
  response: { mode: 'json', schema: ChangeMessageVisibilityResponseSchema },
})
export type AwsSqsChangeMessageVisibilityRequest = ContractBodyInput<
  typeof awsSqsChangeMessageVisibilityContract
>
export type AwsSqsChangeMessageVisibilityBody = ContractBody<
  typeof awsSqsChangeMessageVisibilityContract
>
export type AwsSqsChangeMessageVisibilityResponse = ContractJsonResponse<
  typeof awsSqsChangeMessageVisibilityContract
>
