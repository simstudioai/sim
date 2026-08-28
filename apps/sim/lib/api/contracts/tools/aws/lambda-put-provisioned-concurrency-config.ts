import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaProvisionedConcurrencySchema,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const PutProvisionedConcurrencyConfigSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z.string().min(1, 'functionName is required'),
  qualifier: z.string().min(1, 'qualifier is required'),
  provisionedConcurrentExecutions: z
    .number()
    .int()
    .min(1, 'provisionedConcurrentExecutions must be at least 1'),
})

const PutProvisionedConcurrencyConfigResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    provisionedConcurrency: lambdaProvisionedConcurrencySchema,
  }),
})

export const awsLambdaPutProvisionedConcurrencyConfigContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/put-provisioned-concurrency-config',
  body: PutProvisionedConcurrencyConfigSchema,
  response: { mode: 'json', schema: PutProvisionedConcurrencyConfigResponseSchema },
})
export type AwsLambdaPutProvisionedConcurrencyConfigRequest = ContractBodyInput<
  typeof awsLambdaPutProvisionedConcurrencyConfigContract
>
export type AwsLambdaPutProvisionedConcurrencyConfigBody = ContractBody<
  typeof awsLambdaPutProvisionedConcurrencyConfigContract
>
export type AwsLambdaPutProvisionedConcurrencyConfigResponse = ContractJsonResponse<
  typeof awsLambdaPutProvisionedConcurrencyConfigContract
>
