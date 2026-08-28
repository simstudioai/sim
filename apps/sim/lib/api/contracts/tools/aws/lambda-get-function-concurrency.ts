import { z } from 'zod'
import { lambdaConnectionFields } from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetFunctionConcurrencySchema = z.object({
  ...lambdaConnectionFields,
  functionName: z.string().min(1, 'functionName is required'),
})

const GetFunctionConcurrencyResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    reservedConcurrentExecutions: z.number().nullable(),
  }),
})

export const awsLambdaGetFunctionConcurrencyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/get-function-concurrency',
  body: GetFunctionConcurrencySchema,
  response: { mode: 'json', schema: GetFunctionConcurrencyResponseSchema },
})
export type AwsLambdaGetFunctionConcurrencyRequest = ContractBodyInput<
  typeof awsLambdaGetFunctionConcurrencyContract
>
export type AwsLambdaGetFunctionConcurrencyBody = ContractBody<
  typeof awsLambdaGetFunctionConcurrencyContract
>
export type AwsLambdaGetFunctionConcurrencyResponse = ContractJsonResponse<
  typeof awsLambdaGetFunctionConcurrencyContract
>
