import { z } from 'zod'
import { sqsConnectionFields, sqsQueueUrlField } from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DeleteQueueSchema = z.object({
  ...sqsConnectionFields,
  queueUrl: sqsQueueUrlField,
})

const DeleteQueueResponseSchema = z.object({
  message: z.string(),
})

export const awsSqsDeleteQueueContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/delete-queue',
  body: DeleteQueueSchema,
  response: { mode: 'json', schema: DeleteQueueResponseSchema },
})
export type AwsSqsDeleteQueueRequest = ContractBodyInput<typeof awsSqsDeleteQueueContract>
export type AwsSqsDeleteQueueBody = ContractBody<typeof awsSqsDeleteQueueContract>
export type AwsSqsDeleteQueueResponse = ContractJsonResponse<typeof awsSqsDeleteQueueContract>
