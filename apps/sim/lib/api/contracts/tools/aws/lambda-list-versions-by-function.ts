import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaFunctionConfigurationSchema,
  lambdaPaginationFields,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListVersionsByFunctionSchema = z.object({
  ...lambdaConnectionFields,
  ...lambdaPaginationFields,
  functionName: z.string().min(1, 'functionName is required'),
})

const ListVersionsByFunctionResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    versions: z.array(lambdaFunctionConfigurationSchema),
    nextMarker: z.string().nullable(),
  }),
})

export const awsLambdaListVersionsByFunctionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/list-versions-by-function',
  body: ListVersionsByFunctionSchema,
  response: { mode: 'json', schema: ListVersionsByFunctionResponseSchema },
})
export type AwsLambdaListVersionsByFunctionRequest = ContractBodyInput<
  typeof awsLambdaListVersionsByFunctionContract
>
export type AwsLambdaListVersionsByFunctionBody = ContractBody<
  typeof awsLambdaListVersionsByFunctionContract
>
export type AwsLambdaListVersionsByFunctionResponse = ContractJsonResponse<
  typeof awsLambdaListVersionsByFunctionContract
>
