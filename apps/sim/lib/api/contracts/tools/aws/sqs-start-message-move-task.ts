import { z } from 'zod'
import { sqsConnectionFields, sqsQueueArnSchema } from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const StartMessageMoveTaskSchema = z.object({
  ...sqsConnectionFields,
  sourceArn: sqsQueueArnSchema,
  destinationArn: sqsQueueArnSchema.nullish(),
  maxNumberOfMessagesPerSecond: z
    .number()
    .int()
    .min(1, 'maxNumberOfMessagesPerSecond must be at least 1')
    .max(500, 'maxNumberOfMessagesPerSecond cannot exceed 500')
    .nullish(),
})

const StartMessageMoveTaskResponseSchema = z.object({
  message: z.string(),
  taskHandle: z.string().nullable(),
})

export const awsSqsStartMessageMoveTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/start-message-move-task',
  body: StartMessageMoveTaskSchema,
  response: { mode: 'json', schema: StartMessageMoveTaskResponseSchema },
})
export type AwsSqsStartMessageMoveTaskRequest = ContractBodyInput<
  typeof awsSqsStartMessageMoveTaskContract
>
export type AwsSqsStartMessageMoveTaskBody = ContractBody<typeof awsSqsStartMessageMoveTaskContract>
export type AwsSqsStartMessageMoveTaskResponse = ContractJsonResponse<
  typeof awsSqsStartMessageMoveTaskContract
>
