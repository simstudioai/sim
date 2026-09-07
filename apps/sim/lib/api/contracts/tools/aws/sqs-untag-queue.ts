import { z } from 'zod'
import { sqsConnectionFields, sqsQueueUrlField } from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const UntagQueueSchema = z.object({
  ...sqsConnectionFields,
  queueUrl: sqsQueueUrlField,
  tagKeys: z
    .array(z.string().min(1, 'Tag key cannot be empty'))
    .min(1, 'At least one tag key is required'),
})

const UntagQueueResponseSchema = z.object({
  message: z.string(),
})

export const awsSqsUntagQueueContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/untag-queue',
  body: UntagQueueSchema,
  response: { mode: 'json', schema: UntagQueueResponseSchema },
})
export type AwsSqsUntagQueueRequest = ContractBodyInput<typeof awsSqsUntagQueueContract>
export type AwsSqsUntagQueueBody = ContractBody<typeof awsSqsUntagQueueContract>
export type AwsSqsUntagQueueResponse = ContractJsonResponse<typeof awsSqsUntagQueueContract>
