import { z } from 'zod'
import { sqsConnectionFields, sqsQueueUrlField } from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListQueueTagsSchema = z.object({
  ...sqsConnectionFields,
  queueUrl: sqsQueueUrlField,
})

const ListQueueTagsResponseSchema = z.object({
  tags: z.record(z.string(), z.string()),
})

export const awsSqsListQueueTagsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/list-queue-tags',
  body: ListQueueTagsSchema,
  response: { mode: 'json', schema: ListQueueTagsResponseSchema },
})
export type AwsSqsListQueueTagsRequest = ContractBodyInput<typeof awsSqsListQueueTagsContract>
export type AwsSqsListQueueTagsBody = ContractBody<typeof awsSqsListQueueTagsContract>
export type AwsSqsListQueueTagsResponse = ContractJsonResponse<typeof awsSqsListQueueTagsContract>
