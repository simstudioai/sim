import { z } from 'zod'
import { sqsConnectionFields, sqsQueueArnSchema } from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListMessageMoveTasksSchema = z.object({
  ...sqsConnectionFields,
  sourceArn: sqsQueueArnSchema,
  maxResults: z
    .number()
    .int()
    .min(1, 'maxResults must be at least 1')
    .max(10, 'maxResults cannot exceed 10')
    .nullish(),
})

const ListMessageMoveTasksResponseSchema = z.object({
  results: z.array(
    z.object({
      taskHandle: z.string().nullable(),
      status: z.string().nullable(),
      sourceArn: z.string().nullable(),
      destinationArn: z.string().nullable(),
      maxNumberOfMessagesPerSecond: z.number().nullable(),
      approximateNumberOfMessagesMoved: z.number().nullable(),
      approximateNumberOfMessagesToMove: z.number().nullable(),
      failureReason: z.string().nullable(),
      startedTimestamp: z.number().nullable(),
    })
  ),
  count: z.number(),
})

export const awsSqsListMessageMoveTasksContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/list-message-move-tasks',
  body: ListMessageMoveTasksSchema,
  response: { mode: 'json', schema: ListMessageMoveTasksResponseSchema },
})
export type AwsSqsListMessageMoveTasksRequest = ContractBodyInput<
  typeof awsSqsListMessageMoveTasksContract
>
export type AwsSqsListMessageMoveTasksBody = ContractBody<typeof awsSqsListMessageMoveTasksContract>
export type AwsSqsListMessageMoveTasksResponse = ContractJsonResponse<
  typeof awsSqsListMessageMoveTasksContract
>
