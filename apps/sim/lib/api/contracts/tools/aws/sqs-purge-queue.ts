import { z } from 'zod'
import { sqsConnectionFields, sqsQueueUrlField } from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const PurgeQueueSchema = z.object({
  ...sqsConnectionFields,
  queueUrl: sqsQueueUrlField,
})

const PurgeQueueResponseSchema = z.object({
  message: z.string(),
})

export const awsSqsPurgeQueueContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/purge-queue',
  body: PurgeQueueSchema,
  response: { mode: 'json', schema: PurgeQueueResponseSchema },
})
export type AwsSqsPurgeQueueRequest = ContractBodyInput<typeof awsSqsPurgeQueueContract>
export type AwsSqsPurgeQueueBody = ContractBody<typeof awsSqsPurgeQueueContract>
export type AwsSqsPurgeQueueResponse = ContractJsonResponse<typeof awsSqsPurgeQueueContract>
