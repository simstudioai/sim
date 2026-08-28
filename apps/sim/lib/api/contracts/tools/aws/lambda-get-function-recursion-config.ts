import { z } from 'zod'
import { lambdaConnectionFields } from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetFunctionRecursionConfigSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z
    .string()
    .min(1, 'functionName is required')
    .max(256, 'functionName cannot exceed 256 characters'),
})

const GetFunctionRecursionConfigResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    recursiveLoop: z.string().nullable(),
  }),
})

export const awsLambdaGetFunctionRecursionConfigContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/get-function-recursion-config',
  body: GetFunctionRecursionConfigSchema,
  response: { mode: 'json', schema: GetFunctionRecursionConfigResponseSchema },
})
export type AwsLambdaGetFunctionRecursionConfigRequest = ContractBodyInput<
  typeof awsLambdaGetFunctionRecursionConfigContract
>
export type AwsLambdaGetFunctionRecursionConfigBody = ContractBody<
  typeof awsLambdaGetFunctionRecursionConfigContract
>
export type AwsLambdaGetFunctionRecursionConfigResponse = ContractJsonResponse<
  typeof awsLambdaGetFunctionRecursionConfigContract
>
