import { z } from 'zod'
import { lambdaConnectionFields } from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const PutFunctionConcurrencySchema = z.object({
  ...lambdaConnectionFields,
  functionName: z.string().min(1, 'functionName is required'),
  reservedConcurrentExecutions: z
    .number()
    .int()
    .min(0, 'reservedConcurrentExecutions cannot be negative'),
})

const PutFunctionConcurrencyResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    reservedConcurrentExecutions: z.number().nullable(),
  }),
})

export const awsLambdaPutFunctionConcurrencyContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/put-function-concurrency',
  body: PutFunctionConcurrencySchema,
  response: { mode: 'json', schema: PutFunctionConcurrencyResponseSchema },
})
export type AwsLambdaPutFunctionConcurrencyRequest = ContractBodyInput<
  typeof awsLambdaPutFunctionConcurrencyContract
>
export type AwsLambdaPutFunctionConcurrencyBody = ContractBody<
  typeof awsLambdaPutFunctionConcurrencyContract
>
export type AwsLambdaPutFunctionConcurrencyResponse = ContractJsonResponse<
  typeof awsLambdaPutFunctionConcurrencyContract
>
