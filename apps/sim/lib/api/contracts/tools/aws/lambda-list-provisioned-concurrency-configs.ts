import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaProvisionedConcurrencySchema,
  lambdaSmallPaginationFields,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListProvisionedConcurrencyConfigsSchema = z.object({
  ...lambdaConnectionFields,
  ...lambdaSmallPaginationFields,
  functionName: z.string().min(1, 'functionName is required'),
})

const ListProvisionedConcurrencyConfigsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    provisionedConcurrencyConfigs: z.array(lambdaProvisionedConcurrencySchema),
    nextMarker: z.string().nullable(),
  }),
})

export const awsLambdaListProvisionedConcurrencyConfigsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/list-provisioned-concurrency-configs',
  body: ListProvisionedConcurrencyConfigsSchema,
  response: { mode: 'json', schema: ListProvisionedConcurrencyConfigsResponseSchema },
})
export type AwsLambdaListProvisionedConcurrencyConfigsRequest = ContractBodyInput<
  typeof awsLambdaListProvisionedConcurrencyConfigsContract
>
export type AwsLambdaListProvisionedConcurrencyConfigsBody = ContractBody<
  typeof awsLambdaListProvisionedConcurrencyConfigsContract
>
export type AwsLambdaListProvisionedConcurrencyConfigsResponse = ContractJsonResponse<
  typeof awsLambdaListProvisionedConcurrencyConfigsContract
>
