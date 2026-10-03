import { z } from 'zod'
import {
  sqsAwsAccountIdSchema,
  sqsConnectionFields,
  sqsQueueNameField,
} from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetQueueUrlSchema = z.object({
  ...sqsConnectionFields,
  queueName: sqsQueueNameField,
  queueOwnerAwsAccountId: sqsAwsAccountIdSchema.nullish(),
})

const GetQueueUrlResponseSchema = z.object({
  queueUrl: z.string().nullable(),
})

export const awsSqsGetQueueUrlContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/get-queue-url',
  body: GetQueueUrlSchema,
  response: { mode: 'json', schema: GetQueueUrlResponseSchema },
})
export type AwsSqsGetQueueUrlRequest = ContractBodyInput<typeof awsSqsGetQueueUrlContract>
export type AwsSqsGetQueueUrlBody = ContractBody<typeof awsSqsGetQueueUrlContract>
export type AwsSqsGetQueueUrlResponse = ContractJsonResponse<typeof awsSqsGetQueueUrlContract>
