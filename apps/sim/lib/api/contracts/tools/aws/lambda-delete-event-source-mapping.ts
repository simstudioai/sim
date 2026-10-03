import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaEventSourceMappingSchema,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DeleteEventSourceMappingSchema = z.object({
  ...lambdaConnectionFields,
  uuid: z.string().min(1, 'uuid is required'),
})

const DeleteEventSourceMappingResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    eventSourceMapping: lambdaEventSourceMappingSchema,
  }),
})

export const awsLambdaDeleteEventSourceMappingContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/delete-event-source-mapping',
  body: DeleteEventSourceMappingSchema,
  response: { mode: 'json', schema: DeleteEventSourceMappingResponseSchema },
})
export type AwsLambdaDeleteEventSourceMappingRequest = ContractBodyInput<
  typeof awsLambdaDeleteEventSourceMappingContract
>
export type AwsLambdaDeleteEventSourceMappingBody = ContractBody<
  typeof awsLambdaDeleteEventSourceMappingContract
>
export type AwsLambdaDeleteEventSourceMappingResponse = ContractJsonResponse<
  typeof awsLambdaDeleteEventSourceMappingContract
>
