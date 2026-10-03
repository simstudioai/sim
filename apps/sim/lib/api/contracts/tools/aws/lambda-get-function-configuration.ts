import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaFunctionConfigurationSchema,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetFunctionConfigurationSchema = z.object({
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

const GetFunctionConfigurationResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    configuration: lambdaFunctionConfigurationSchema,
  }),
})

export const awsLambdaGetFunctionConfigurationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/get-function-configuration',
  body: GetFunctionConfigurationSchema,
  response: { mode: 'json', schema: GetFunctionConfigurationResponseSchema },
})
export type AwsLambdaGetFunctionConfigurationRequest = ContractBodyInput<
  typeof awsLambdaGetFunctionConfigurationContract
>
export type AwsLambdaGetFunctionConfigurationBody = ContractBody<
  typeof awsLambdaGetFunctionConfigurationContract
>
export type AwsLambdaGetFunctionConfigurationResponse = ContractJsonResponse<
  typeof awsLambdaGetFunctionConfigurationContract
>
