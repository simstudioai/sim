import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaLayerSchema,
  lambdaSmallPaginationFields,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListLayersSchema = z.object({
  ...lambdaConnectionFields,
  ...lambdaSmallPaginationFields,
  compatibleRuntime: z.string().min(1, 'compatibleRuntime cannot be empty').optional(),
  compatibleArchitecture: z.enum(['x86_64', 'arm64']).optional(),
})

const ListLayersResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    layers: z.array(lambdaLayerSchema),
    nextMarker: z.string().nullable(),
  }),
})

export const awsLambdaListLayersContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/list-layers',
  body: ListLayersSchema,
  response: { mode: 'json', schema: ListLayersResponseSchema },
})
export type AwsLambdaListLayersRequest = ContractBodyInput<typeof awsLambdaListLayersContract>
export type AwsLambdaListLayersBody = ContractBody<typeof awsLambdaListLayersContract>
export type AwsLambdaListLayersResponse = ContractJsonResponse<typeof awsLambdaListLayersContract>
