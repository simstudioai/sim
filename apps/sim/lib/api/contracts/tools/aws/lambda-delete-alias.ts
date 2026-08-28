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

const DeleteAliasSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z
    .string()
    .min(1, 'functionName is required')
    .max(256, 'functionName cannot exceed 256 characters'),
  aliasName: z.string().min(1, 'aliasName is required'),
})

const DeleteAliasResponseSchema = lambdaMessageResponseSchema

export const awsLambdaDeleteAliasContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/delete-alias',
  body: DeleteAliasSchema,
  response: { mode: 'json', schema: DeleteAliasResponseSchema },
})
export type AwsLambdaDeleteAliasRequest = ContractBodyInput<typeof awsLambdaDeleteAliasContract>
export type AwsLambdaDeleteAliasBody = ContractBody<typeof awsLambdaDeleteAliasContract>
export type AwsLambdaDeleteAliasResponse = ContractJsonResponse<typeof awsLambdaDeleteAliasContract>
