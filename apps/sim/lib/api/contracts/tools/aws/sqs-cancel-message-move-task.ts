import { z } from 'zod'
import { sqsConnectionFields } from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const CancelMessageMoveTaskSchema = z.object({
  ...sqsConnectionFields,
  taskHandle: z.string().min(1, 'Task handle is required'),
})

const CancelMessageMoveTaskResponseSchema = z.object({
  message: z.string(),
  approximateNumberOfMessagesMoved: z.number().nullable(),
})

export const awsSqsCancelMessageMoveTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/cancel-message-move-task',
  body: CancelMessageMoveTaskSchema,
  response: { mode: 'json', schema: CancelMessageMoveTaskResponseSchema },
})
export type AwsSqsCancelMessageMoveTaskRequest = ContractBodyInput<
  typeof awsSqsCancelMessageMoveTaskContract
>
export type AwsSqsCancelMessageMoveTaskBody = ContractBody<
  typeof awsSqsCancelMessageMoveTaskContract
>
export type AwsSqsCancelMessageMoveTaskResponse = ContractJsonResponse<
  typeof awsSqsCancelMessageMoveTaskContract
>
