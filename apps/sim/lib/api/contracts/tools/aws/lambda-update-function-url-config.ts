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

const UpdateFunctionUrlConfigSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z.string().min(1, 'functionName is required'),
  authType: z.enum(['NONE', 'AWS_IAM']).optional(),
  qualifier: z.string().optional(),
  invokeMode: z.enum(['BUFFERED', 'RESPONSE_STREAM']).optional(),
  corsAllowCredentials: z.boolean().optional(),
  corsAllowOrigins: z.array(z.string()).optional(),
  corsAllowMethods: z.array(z.string()).optional(),
  corsAllowHeaders: z.array(z.string()).optional(),
  corsExposeHeaders: z.array(z.string()).optional(),
  corsMaxAge: z.number().int().min(0).max(86400).optional(),
})

const UpdateFunctionUrlConfigResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    functionUrlConfig: lambdaFunctionUrlConfigSchema,
  }),
})

export const awsLambdaUpdateFunctionUrlConfigContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/update-function-url-config',
  body: UpdateFunctionUrlConfigSchema,
  response: { mode: 'json', schema: UpdateFunctionUrlConfigResponseSchema },
})
export type AwsLambdaUpdateFunctionUrlConfigRequest = ContractBodyInput<
  typeof awsLambdaUpdateFunctionUrlConfigContract
>
export type AwsLambdaUpdateFunctionUrlConfigBody = ContractBody<
  typeof awsLambdaUpdateFunctionUrlConfigContract
>
export type AwsLambdaUpdateFunctionUrlConfigResponse = ContractJsonResponse<
  typeof awsLambdaUpdateFunctionUrlConfigContract
>
