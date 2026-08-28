import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaEventSourceMappingSchema,
  lambdaPaginationFields,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListEventSourceMappingsSchema = z.object({
  ...lambdaConnectionFields,
  ...lambdaPaginationFields,
  functionName: z.string().optional(),
  eventSourceArn: z.string().optional(),
})

const ListEventSourceMappingsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    eventSourceMappings: z.array(lambdaEventSourceMappingSchema),
    nextMarker: z.string().nullable(),
  }),
})

export const awsLambdaListEventSourceMappingsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/list-event-source-mappings',
  body: ListEventSourceMappingsSchema,
  response: { mode: 'json', schema: ListEventSourceMappingsResponseSchema },
})
export type AwsLambdaListEventSourceMappingsRequest = ContractBodyInput<
  typeof awsLambdaListEventSourceMappingsContract
>
export type AwsLambdaListEventSourceMappingsBody = ContractBody<
  typeof awsLambdaListEventSourceMappingsContract
>
export type AwsLambdaListEventSourceMappingsResponse = ContractJsonResponse<
  typeof awsLambdaListEventSourceMappingsContract
>
