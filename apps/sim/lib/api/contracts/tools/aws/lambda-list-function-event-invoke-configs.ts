import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaEventInvokeConfigSchema,
  lambdaSmallPaginationFields,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListFunctionEventInvokeConfigsSchema = z.object({
  ...lambdaConnectionFields,
  ...lambdaSmallPaginationFields,
  functionName: z.string().min(1, 'functionName is required'),
})

const ListFunctionEventInvokeConfigsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    eventInvokeConfigs: z.array(lambdaEventInvokeConfigSchema),
    nextMarker: z.string().nullable(),
  }),
})

export const awsLambdaListFunctionEventInvokeConfigsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/list-function-event-invoke-configs',
  body: ListFunctionEventInvokeConfigsSchema,
  response: { mode: 'json', schema: ListFunctionEventInvokeConfigsResponseSchema },
})
export type AwsLambdaListFunctionEventInvokeConfigsRequest = ContractBodyInput<
  typeof awsLambdaListFunctionEventInvokeConfigsContract
>
export type AwsLambdaListFunctionEventInvokeConfigsBody = ContractBody<
  typeof awsLambdaListFunctionEventInvokeConfigsContract
>
export type AwsLambdaListFunctionEventInvokeConfigsResponse = ContractJsonResponse<
  typeof awsLambdaListFunctionEventInvokeConfigsContract
>
