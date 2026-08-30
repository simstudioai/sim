import { z } from 'zod'
import {
  lambdaAliasSchema,
  lambdaConnectionFields,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetAliasSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z
    .string()
    .min(1, 'functionName is required')
    .max(256, 'functionName cannot exceed 256 characters'),
  aliasName: z
    .string()
    .min(1, 'aliasName is required')
    .max(128, 'aliasName cannot exceed 128 characters')
    .regex(
      /^(?![0-9]+$)[a-zA-Z0-9-_]+$/,
      'aliasName may only contain letters, numbers, hyphens, and underscores, and cannot be all digits'
    ),
})

const GetAliasResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    alias: lambdaAliasSchema,
  }),
})

export const awsLambdaGetAliasContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/get-alias',
  body: GetAliasSchema,
  response: { mode: 'json', schema: GetAliasResponseSchema },
})
export type AwsLambdaGetAliasRequest = ContractBodyInput<typeof awsLambdaGetAliasContract>
export type AwsLambdaGetAliasBody = ContractBody<typeof awsLambdaGetAliasContract>
export type AwsLambdaGetAliasResponse = ContractJsonResponse<typeof awsLambdaGetAliasContract>
