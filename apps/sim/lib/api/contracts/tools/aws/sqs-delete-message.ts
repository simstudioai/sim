import { z } from 'zod'
import { sqsConnectionFields, sqsQueueUrlField } from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DeleteMessageSchema = z.object({
  ...sqsConnectionFields,
  queueUrl: sqsQueueUrlField,
  receiptHandle: z.string().min(1, 'Receipt handle is required'),
})

const DeleteMessageResponseSchema = z.object({
  message: z.string(),
})

export const awsSqsDeleteMessageContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/delete-message',
  body: DeleteMessageSchema,
  response: { mode: 'json', schema: DeleteMessageResponseSchema },
})
export type AwsSqsDeleteMessageRequest = ContractBodyInput<typeof awsSqsDeleteMessageContract>
export type AwsSqsDeleteMessageBody = ContractBody<typeof awsSqsDeleteMessageContract>
export type AwsSqsDeleteMessageResponse = ContractJsonResponse<typeof awsSqsDeleteMessageContract>
