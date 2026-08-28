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

const DeleteFunctionEventInvokeConfigSchema = z.object({
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

const DeleteFunctionEventInvokeConfigResponseSchema = lambdaMessageResponseSchema

export const awsLambdaDeleteFunctionEventInvokeConfigContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/delete-function-event-invoke-config',
  body: DeleteFunctionEventInvokeConfigSchema,
  response: { mode: 'json', schema: DeleteFunctionEventInvokeConfigResponseSchema },
})
export type AwsLambdaDeleteFunctionEventInvokeConfigRequest = ContractBodyInput<
  typeof awsLambdaDeleteFunctionEventInvokeConfigContract
>
export type AwsLambdaDeleteFunctionEventInvokeConfigBody = ContractBody<
  typeof awsLambdaDeleteFunctionEventInvokeConfigContract
>
export type AwsLambdaDeleteFunctionEventInvokeConfigResponse = ContractJsonResponse<
  typeof awsLambdaDeleteFunctionEventInvokeConfigContract
>
