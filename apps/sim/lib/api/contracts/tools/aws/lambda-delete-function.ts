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

const DeleteFunctionSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z.string().min(1, 'functionName is required'),
  qualifier: z.string().optional(),
})

const DeleteFunctionResponseSchema = lambdaMessageResponseSchema

export const awsLambdaDeleteFunctionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/delete-function',
  body: DeleteFunctionSchema,
  response: { mode: 'json', schema: DeleteFunctionResponseSchema },
})
export type AwsLambdaDeleteFunctionRequest = ContractBodyInput<
  typeof awsLambdaDeleteFunctionContract
>
export type AwsLambdaDeleteFunctionBody = ContractBody<typeof awsLambdaDeleteFunctionContract>
export type AwsLambdaDeleteFunctionResponse = ContractJsonResponse<
  typeof awsLambdaDeleteFunctionContract
>
