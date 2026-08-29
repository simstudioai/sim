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

const PutFunctionEventInvokeConfigSchema = z.object({
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
  maximumRetryAttempts: z.number().int().min(0).max(2).optional(),
  maximumEventAgeInSeconds: z.number().int().min(60).max(21600).optional(),
  onSuccessDestination: z.string().optional(),
  onFailureDestination: z.string().optional(),
})

const PutFunctionEventInvokeConfigResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    eventInvokeConfig: lambdaEventInvokeConfigSchema,
  }),
})

export const awsLambdaPutFunctionEventInvokeConfigContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/put-function-event-invoke-config',
  body: PutFunctionEventInvokeConfigSchema,
  response: { mode: 'json', schema: PutFunctionEventInvokeConfigResponseSchema },
})
export type AwsLambdaPutFunctionEventInvokeConfigRequest = ContractBodyInput<
  typeof awsLambdaPutFunctionEventInvokeConfigContract
>
export type AwsLambdaPutFunctionEventInvokeConfigBody = ContractBody<
  typeof awsLambdaPutFunctionEventInvokeConfigContract
>
export type AwsLambdaPutFunctionEventInvokeConfigResponse = ContractJsonResponse<
  typeof awsLambdaPutFunctionEventInvokeConfigContract
>
