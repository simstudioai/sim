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

const DeleteFunctionConcurrencySchema = z.object({
  ...lambdaConnectionFields,
  functionName: z.string().min(1, 'functionName is required'),
})

const DeleteFunctionConcurrencyResponseSchema = lambdaMessageResponseSchema

export const awsLambdaDeleteFunctionConcurrencyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/delete-function-concurrency',
  body: DeleteFunctionConcurrencySchema,
  response: { mode: 'json', schema: DeleteFunctionConcurrencyResponseSchema },
})
export type AwsLambdaDeleteFunctionConcurrencyRequest = ContractBodyInput<
  typeof awsLambdaDeleteFunctionConcurrencyContract
>
export type AwsLambdaDeleteFunctionConcurrencyBody = ContractBody<
  typeof awsLambdaDeleteFunctionConcurrencyContract
>
export type AwsLambdaDeleteFunctionConcurrencyResponse = ContractJsonResponse<
  typeof awsLambdaDeleteFunctionConcurrencyContract
>
