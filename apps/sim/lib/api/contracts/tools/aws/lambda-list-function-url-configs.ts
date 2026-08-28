import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaFunctionUrlConfigSchema,
  lambdaSmallPaginationFields,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListFunctionUrlConfigsSchema = z.object({
  ...lambdaConnectionFields,
  ...lambdaSmallPaginationFields,
  functionName: z.string().min(1, 'functionName is required'),
})

const ListFunctionUrlConfigsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    functionUrlConfigs: z.array(lambdaFunctionUrlConfigSchema),
    nextMarker: z.string().nullable(),
  }),
})

export const awsLambdaListFunctionUrlConfigsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/list-function-url-configs',
  body: ListFunctionUrlConfigsSchema,
  response: { mode: 'json', schema: ListFunctionUrlConfigsResponseSchema },
})
export type AwsLambdaListFunctionUrlConfigsRequest = ContractBodyInput<
  typeof awsLambdaListFunctionUrlConfigsContract
>
export type AwsLambdaListFunctionUrlConfigsBody = ContractBody<
  typeof awsLambdaListFunctionUrlConfigsContract
>
export type AwsLambdaListFunctionUrlConfigsResponse = ContractJsonResponse<
  typeof awsLambdaListFunctionUrlConfigsContract
>
