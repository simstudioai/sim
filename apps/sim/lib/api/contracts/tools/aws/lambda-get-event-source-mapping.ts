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

const GetEventSourceMappingSchema = z.object({
  ...lambdaConnectionFields,
  uuid: z.string().min(1, 'uuid is required'),
})

const GetEventSourceMappingResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    eventSourceMapping: lambdaEventSourceMappingSchema,
  }),
})

export const awsLambdaGetEventSourceMappingContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/get-event-source-mapping',
  body: GetEventSourceMappingSchema,
  response: { mode: 'json', schema: GetEventSourceMappingResponseSchema },
})
export type AwsLambdaGetEventSourceMappingRequest = ContractBodyInput<
  typeof awsLambdaGetEventSourceMappingContract
>
export type AwsLambdaGetEventSourceMappingBody = ContractBody<
  typeof awsLambdaGetEventSourceMappingContract
>
export type AwsLambdaGetEventSourceMappingResponse = ContractJsonResponse<
  typeof awsLambdaGetEventSourceMappingContract
>
