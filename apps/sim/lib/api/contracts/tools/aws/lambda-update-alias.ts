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

const UpdateAliasSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z.string().min(1, 'functionName is required'),
  aliasName: z.string().min(1, 'aliasName is required'),
  aliasFunctionVersion: z.string().optional(),
  description: z.string().optional(),
  additionalVersionWeights: z.record(z.string(), z.number()).optional(),
  revisionId: z.string().optional(),
})

const UpdateAliasResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    alias: lambdaAliasSchema,
  }),
})

export const awsLambdaUpdateAliasContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/update-alias',
  body: UpdateAliasSchema,
  response: { mode: 'json', schema: UpdateAliasResponseSchema },
})
export type AwsLambdaUpdateAliasRequest = ContractBodyInput<typeof awsLambdaUpdateAliasContract>
export type AwsLambdaUpdateAliasBody = ContractBody<typeof awsLambdaUpdateAliasContract>
export type AwsLambdaUpdateAliasResponse = ContractJsonResponse<typeof awsLambdaUpdateAliasContract>
