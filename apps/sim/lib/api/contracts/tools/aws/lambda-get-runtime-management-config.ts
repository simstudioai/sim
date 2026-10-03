import { z } from 'zod'
import { lambdaConnectionFields } from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetRuntimeManagementConfigSchema = z.object({
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

const GetRuntimeManagementConfigResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    updateRuntimeOn: z.string().nullable(),
    runtimeVersionArn: z.string().nullable(),
    functionArn: z.string().nullable(),
  }),
})

export const awsLambdaGetRuntimeManagementConfigContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/get-runtime-management-config',
  body: GetRuntimeManagementConfigSchema,
  response: { mode: 'json', schema: GetRuntimeManagementConfigResponseSchema },
})
export type AwsLambdaGetRuntimeManagementConfigRequest = ContractBodyInput<
  typeof awsLambdaGetRuntimeManagementConfigContract
>
export type AwsLambdaGetRuntimeManagementConfigBody = ContractBody<
  typeof awsLambdaGetRuntimeManagementConfigContract
>
export type AwsLambdaGetRuntimeManagementConfigResponse = ContractJsonResponse<
  typeof awsLambdaGetRuntimeManagementConfigContract
>
