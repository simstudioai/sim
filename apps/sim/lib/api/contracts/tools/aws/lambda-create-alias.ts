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

const CreateAliasSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z.string().min(1, 'functionName is required'),
  aliasName: z.string().min(1, 'aliasName is required'),
  aliasFunctionVersion: z.string().min(1, 'aliasFunctionVersion is required'),
  description: z.string().optional(),
  additionalVersionWeights: z.record(z.string(), z.number()).optional(),
})

const CreateAliasResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    alias: lambdaAliasSchema,
  }),
})

export const awsLambdaCreateAliasContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/create-alias',
  body: CreateAliasSchema,
  response: { mode: 'json', schema: CreateAliasResponseSchema },
})
export type AwsLambdaCreateAliasRequest = ContractBodyInput<typeof awsLambdaCreateAliasContract>
export type AwsLambdaCreateAliasBody = ContractBody<typeof awsLambdaCreateAliasContract>
export type AwsLambdaCreateAliasResponse = ContractJsonResponse<typeof awsLambdaCreateAliasContract>
