import { z } from 'zod'
import {
  sqsConnectionFields,
  sqsQueueAttributeNameSchema,
  sqsQueueUrlField,
} from '@/lib/api/contracts/tools/aws/sqs-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetQueueAttributesSchema = z.object({
  ...sqsConnectionFields,
  queueUrl: sqsQueueUrlField,
  attributeNames: z.array(sqsQueueAttributeNameSchema).nullish(),
})

const GetQueueAttributesResponseSchema = z.object({
  attributes: z.record(z.string(), z.string()),
})

export const awsSqsGetQueueAttributesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/sqs/get-queue-attributes',
  body: GetQueueAttributesSchema,
  response: { mode: 'json', schema: GetQueueAttributesResponseSchema },
})
export type AwsSqsGetQueueAttributesRequest = ContractBodyInput<
  typeof awsSqsGetQueueAttributesContract
>
export type AwsSqsGetQueueAttributesBody = ContractBody<typeof awsSqsGetQueueAttributesContract>
export type AwsSqsGetQueueAttributesResponse = ContractJsonResponse<
  typeof awsSqsGetQueueAttributesContract
>
