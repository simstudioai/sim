import { z } from 'zod'
import {
  sqsConnectionFields,
  sqsQueueUrlField,
  sqsSetQueueAttributesSchema,
} from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const SetQueueAttributesSchema = z.object({
  ...sqsConnectionFields,
  queueUrl: sqsQueueUrlField,
  attributes: sqsSetQueueAttributesSchema.refine(
    (value) => Object.keys(value).length > 0,
    'At least one queue attribute is required'
  ),
})

const SetQueueAttributesResponseSchema = z.object({
  message: z.string(),
})

export const awsSqsSetQueueAttributesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/set-queue-attributes',
  body: SetQueueAttributesSchema,
  response: { mode: 'json', schema: SetQueueAttributesResponseSchema },
})
export type AwsSqsSetQueueAttributesRequest = ContractBodyInput<
  typeof awsSqsSetQueueAttributesContract
>
export type AwsSqsSetQueueAttributesBody = ContractBody<typeof awsSqsSetQueueAttributesContract>
export type AwsSqsSetQueueAttributesResponse = ContractJsonResponse<
  typeof awsSqsSetQueueAttributesContract
>
