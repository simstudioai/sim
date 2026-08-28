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

const CreateFunctionUrlConfigSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z
    .string()
    .min(1, 'functionName is required')
    .max(256, 'functionName cannot exceed 256 characters'),
  authType: z.enum(['NONE', 'AWS_IAM']),
  qualifier: z
    .string()
    .min(1, 'qualifier cannot be empty')
    .max(128, 'qualifier cannot exceed 128 characters')
    .optional(),
  invokeMode: z.enum(['BUFFERED', 'RESPONSE_STREAM']).optional(),
  corsAllowCredentials: z.boolean().optional(),
  corsAllowOrigins: z.array(z.string()).optional(),
  corsAllowMethods: z.array(z.string()).optional(),
  corsAllowHeaders: z.array(z.string()).optional(),
  corsExposeHeaders: z.array(z.string()).optional(),
  corsMaxAge: z.number().int().min(0).max(86400).optional(),
})

const CreateFunctionUrlConfigResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    functionUrlConfig: lambdaFunctionUrlConfigSchema,
  }),
})

export const awsLambdaCreateFunctionUrlConfigContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/create-function-url-config',
  body: CreateFunctionUrlConfigSchema,
  response: { mode: 'json', schema: CreateFunctionUrlConfigResponseSchema },
})
export type AwsLambdaCreateFunctionUrlConfigRequest = ContractBodyInput<
  typeof awsLambdaCreateFunctionUrlConfigContract
>
export type AwsLambdaCreateFunctionUrlConfigBody = ContractBody<
  typeof awsLambdaCreateFunctionUrlConfigContract
>
export type AwsLambdaCreateFunctionUrlConfigResponse = ContractJsonResponse<
  typeof awsLambdaCreateFunctionUrlConfigContract
>
