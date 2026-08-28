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

const GetProvisionedConcurrencyConfigSchema = z.object({
  ...lambdaConnectionFields,
  functionName: z
    .string()
    .min(1, 'functionName is required')
    .max(256, 'functionName cannot exceed 256 characters'),
  qualifier: z
    .string()
    .min(1, 'qualifier is required')
    .max(128, 'qualifier cannot exceed 128 characters'),
})

const GetProvisionedConcurrencyConfigResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    provisionedConcurrency: lambdaProvisionedConcurrencySchema,
  }),
})

export const awsLambdaGetProvisionedConcurrencyConfigContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/get-provisioned-concurrency-config',
  body: GetProvisionedConcurrencyConfigSchema,
  response: { mode: 'json', schema: GetProvisionedConcurrencyConfigResponseSchema },
})
export type AwsLambdaGetProvisionedConcurrencyConfigRequest = ContractBodyInput<
  typeof awsLambdaGetProvisionedConcurrencyConfigContract
>
export type AwsLambdaGetProvisionedConcurrencyConfigBody = ContractBody<
  typeof awsLambdaGetProvisionedConcurrencyConfigContract
>
export type AwsLambdaGetProvisionedConcurrencyConfigResponse = ContractJsonResponse<
  typeof awsLambdaGetProvisionedConcurrencyConfigContract
>
