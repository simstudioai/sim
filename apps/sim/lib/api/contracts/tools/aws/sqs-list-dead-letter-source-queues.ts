import { z } from 'zod'
import { sqsConnectionFields, sqsQueueUrlField } from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListDeadLetterSourceQueuesSchema = z.object({
  ...sqsConnectionFields,
  queueUrl: sqsQueueUrlField,
  maxResults: z
    .number()
    .int()
    .min(1, 'maxResults must be at least 1')
    .max(1000, 'maxResults cannot exceed 1000')
    .nullish(),
  nextToken: z.string().nullish(),
})

const ListDeadLetterSourceQueuesResponseSchema = z.object({
  queueUrls: z.array(z.string()),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsSqsListDeadLetterSourceQueuesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/list-dead-letter-source-queues',
  body: ListDeadLetterSourceQueuesSchema,
  response: { mode: 'json', schema: ListDeadLetterSourceQueuesResponseSchema },
})
export type AwsSqsListDeadLetterSourceQueuesRequest = ContractBodyInput<
  typeof awsSqsListDeadLetterSourceQueuesContract
>
export type AwsSqsListDeadLetterSourceQueuesBody = ContractBody<
  typeof awsSqsListDeadLetterSourceQueuesContract
>
export type AwsSqsListDeadLetterSourceQueuesResponse = ContractJsonResponse<
  typeof awsSqsListDeadLetterSourceQueuesContract
>
