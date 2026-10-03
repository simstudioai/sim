import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaFunctionUrlConfigSchema,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetFunctionUrlConfigSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z
    .string()
    .min(1, 'functionName is required')
    .max(256, 'functionName cannot exceed 256 characters'),
  qualifier: z
    .string()
    .min(1, 'qualifier cannot be empty')
    .max(128, 'qualifier cannot exceed 128 characters')
    .optional(),
})

const GetFunctionUrlConfigResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    functionUrlConfig: lambdaFunctionUrlConfigSchema,
  }),
})

export const awsLambdaGetFunctionUrlConfigContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/get-function-url-config',
  body: GetFunctionUrlConfigSchema,
  response: { mode: 'json', schema: GetFunctionUrlConfigResponseSchema },
})
export type AwsLambdaGetFunctionUrlConfigRequest = ContractBodyInput<
  typeof awsLambdaGetFunctionUrlConfigContract
>
export type AwsLambdaGetFunctionUrlConfigBody = ContractBody<
  typeof awsLambdaGetFunctionUrlConfigContract
>
export type AwsLambdaGetFunctionUrlConfigResponse = ContractJsonResponse<
  typeof awsLambdaGetFunctionUrlConfigContract
>
