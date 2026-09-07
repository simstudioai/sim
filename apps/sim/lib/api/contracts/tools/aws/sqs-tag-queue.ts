import { z } from 'zod'
import {
  sqsConnectionFields,
  sqsQueueUrlField,
  sqsTagsSchema,
} from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const TagQueueSchema = z.object({
  ...sqsConnectionFields,
  queueUrl: sqsQueueUrlField,
  tags: sqsTagsSchema.refine(
    (value) => Object.keys(value).length > 0,
    'At least one tag is required'
  ),
})

const TagQueueResponseSchema = z.object({
  message: z.string(),
})

export const awsSqsTagQueueContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/tag-queue',
  body: TagQueueSchema,
  response: { mode: 'json', schema: TagQueueResponseSchema },
})
export type AwsSqsTagQueueRequest = ContractBodyInput<typeof awsSqsTagQueueContract>
export type AwsSqsTagQueueBody = ContractBody<typeof awsSqsTagQueueContract>
export type AwsSqsTagQueueResponse = ContractJsonResponse<typeof awsSqsTagQueueContract>
