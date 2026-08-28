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

const GetFunctionSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z.string().min(1, 'functionName is required'),
  qualifier: z.string().optional(),
})

const GetFunctionResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    configuration: lambdaFunctionConfigurationSchema.nullable(),
    code: z
      .object({
        repositoryType: z.string().nullable(),
        location: z.string().nullable(),
        imageUri: z.string().nullable(),
        resolvedImageUri: z.string().nullable(),
        sourceKmsKeyArn: z.string().nullable(),
      })
      .nullable(),
    tags: z.record(z.string(), z.string()),
    reservedConcurrentExecutions: z.number().nullable(),
  }),
})

export const awsLambdaGetFunctionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/get-function',
  body: GetFunctionSchema,
  response: { mode: 'json', schema: GetFunctionResponseSchema },
})
export type AwsLambdaGetFunctionRequest = ContractBodyInput<typeof awsLambdaGetFunctionContract>
export type AwsLambdaGetFunctionBody = ContractBody<typeof awsLambdaGetFunctionContract>
export type AwsLambdaGetFunctionResponse = ContractJsonResponse<typeof awsLambdaGetFunctionContract>
