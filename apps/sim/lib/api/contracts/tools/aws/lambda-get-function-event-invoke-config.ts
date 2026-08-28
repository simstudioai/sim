import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaEventInvokeConfigSchema,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetFunctionEventInvokeConfigSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z.string().min(1, 'functionName is required'),
  qualifier: z.string().optional(),
})

const GetFunctionEventInvokeConfigResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    eventInvokeConfig: lambdaEventInvokeConfigSchema,
  }),
})

export const awsLambdaGetFunctionEventInvokeConfigContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/get-function-event-invoke-config',
  body: GetFunctionEventInvokeConfigSchema,
  response: { mode: 'json', schema: GetFunctionEventInvokeConfigResponseSchema },
})
export type AwsLambdaGetFunctionEventInvokeConfigRequest = ContractBodyInput<
  typeof awsLambdaGetFunctionEventInvokeConfigContract
>
export type AwsLambdaGetFunctionEventInvokeConfigBody = ContractBody<
  typeof awsLambdaGetFunctionEventInvokeConfigContract
>
export type AwsLambdaGetFunctionEventInvokeConfigResponse = ContractJsonResponse<
  typeof awsLambdaGetFunctionEventInvokeConfigContract
>
