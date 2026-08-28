import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaMessageResponseSchema,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const DeleteFunctionUrlConfigSchema = z.object({
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

const DeleteFunctionUrlConfigResponseSchema = lambdaMessageResponseSchema

export const awsLambdaDeleteFunctionUrlConfigContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/delete-function-url-config',
  body: DeleteFunctionUrlConfigSchema,
  response: { mode: 'json', schema: DeleteFunctionUrlConfigResponseSchema },
})
export type AwsLambdaDeleteFunctionUrlConfigRequest = ContractBodyInput<
  typeof awsLambdaDeleteFunctionUrlConfigContract
>
export type AwsLambdaDeleteFunctionUrlConfigBody = ContractBody<
  typeof awsLambdaDeleteFunctionUrlConfigContract
>
export type AwsLambdaDeleteFunctionUrlConfigResponse = ContractJsonResponse<
  typeof awsLambdaDeleteFunctionUrlConfigContract
>
