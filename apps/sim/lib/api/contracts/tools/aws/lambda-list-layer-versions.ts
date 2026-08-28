import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaLayerVersionSchema,
  lambdaSmallPaginationFields,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ListLayerVersionsSchema = z.object({
  ...lambdaConnectionFields,
  ...lambdaSmallPaginationFields,
  layerName: z.string().min(1, 'layerName is required'),
  compatibleRuntime: z.string().optional(),
  compatibleArchitecture: z.enum(['x86_64', 'arm64']).optional(),
})

const ListLayerVersionsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    layerVersions: z.array(lambdaLayerVersionSchema),
    nextMarker: z.string().nullable(),
  }),
})

export const awsLambdaListLayerVersionsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/list-layer-versions',
  body: ListLayerVersionsSchema,
  response: { mode: 'json', schema: ListLayerVersionsResponseSchema },
})
export type AwsLambdaListLayerVersionsRequest = ContractBodyInput<
  typeof awsLambdaListLayerVersionsContract
>
export type AwsLambdaListLayerVersionsBody = ContractBody<typeof awsLambdaListLayerVersionsContract>
export type AwsLambdaListLayerVersionsResponse = ContractJsonResponse<
  typeof awsLambdaListLayerVersionsContract
>
