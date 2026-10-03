import { z } from 'zod'
import { sqsConnectionFields } from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListQueuesSchema = z.object({
  ...sqsConnectionFields,
  queueNamePrefix: z.string().nullish(),
  maxResults: z
    .number()
    .int()
    .min(1, 'maxResults must be at least 1')
    .max(1000, 'maxResults cannot exceed 1000')
    .nullish(),
  nextToken: z.string().nullish(),
})

const ListQueuesResponseSchema = z.object({
  queueUrls: z.array(z.string()),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsSqsListQueuesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/list-queues',
  body: ListQueuesSchema,
  response: { mode: 'json', schema: ListQueuesResponseSchema },
})
export type AwsSqsListQueuesRequest = ContractBodyInput<typeof awsSqsListQueuesContract>
export type AwsSqsListQueuesBody = ContractBody<typeof awsSqsListQueuesContract>
export type AwsSqsListQueuesResponse = ContractJsonResponse<typeof awsSqsListQueuesContract>
