import { z } from 'zod'
import {
  sqsConnectionFields,
  sqsQueueAttributesSchema,
  sqsQueueNameField,
  sqsTagsSchema,
} from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const CreateQueueSchema = z.object({
  ...sqsConnectionFields,
  queueName: sqsQueueNameField,
  attributes: sqsQueueAttributesSchema.nullish(),
  tags: sqsTagsSchema.nullish(),
})

const CreateQueueResponseSchema = z.object({
  message: z.string(),
  queueUrl: z.string().nullable(),
})

export const awsSqsCreateQueueContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/create-queue',
  body: CreateQueueSchema,
  response: { mode: 'json', schema: CreateQueueResponseSchema },
})
export type AwsSqsCreateQueueRequest = ContractBodyInput<typeof awsSqsCreateQueueContract>
export type AwsSqsCreateQueueBody = ContractBody<typeof awsSqsCreateQueueContract>
export type AwsSqsCreateQueueResponse = ContractJsonResponse<typeof awsSqsCreateQueueContract>
