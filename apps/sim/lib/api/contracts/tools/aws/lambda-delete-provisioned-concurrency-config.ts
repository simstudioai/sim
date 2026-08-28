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

const DeleteProvisionedConcurrencyConfigSchema = z.object({
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

const DeleteProvisionedConcurrencyConfigResponseSchema = lambdaMessageResponseSchema

export const awsLambdaDeleteProvisionedConcurrencyConfigContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/delete-provisioned-concurrency-config',
  body: DeleteProvisionedConcurrencyConfigSchema,
  response: { mode: 'json', schema: DeleteProvisionedConcurrencyConfigResponseSchema },
})
export type AwsLambdaDeleteProvisionedConcurrencyConfigRequest = ContractBodyInput<
  typeof awsLambdaDeleteProvisionedConcurrencyConfigContract
>
export type AwsLambdaDeleteProvisionedConcurrencyConfigBody = ContractBody<
  typeof awsLambdaDeleteProvisionedConcurrencyConfigContract
>
export type AwsLambdaDeleteProvisionedConcurrencyConfigResponse = ContractJsonResponse<
  typeof awsLambdaDeleteProvisionedConcurrencyConfigContract
>
