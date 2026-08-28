import { z } from 'zod'
import {
  lambdaConnectionFields,
  lambdaLayerVersionSchema,
} from '@/lib/api/contracts/tools/aws/lambda-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const GetLayerVersionSchema = z.object({
  ...lambdaConnectionFields,
  layerName: z
    .string()
    .min(1, 'layerName is required')
    .max(140, 'layerName cannot exceed 140 characters')
    .regex(
      /^(arn:[a-zA-Z0-9-]+:lambda:[a-zA-Z0-9-]+:d{12}:layer:[a-zA-Z0-9-_]+)$|^[a-zA-Z0-9-_]+$/,
      'layerName must be a layer name or a layer ARN'
    ),
  versionNumber: z.number().int().min(1, 'versionNumber must be at least 1'),
})

const GetLayerVersionResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    layerVersion: lambdaLayerVersionSchema.extend({
      layerArn: z.string().nullable(),
      contentLocation: z.string().nullable(),
      contentCodeSha256: z.string().nullable(),
      contentCodeSize: z.number().nullable(),
      contentSigningProfileVersionArn: z.string().nullable(),
      contentSigningJobArn: z.string().nullable(),
    }),
  }),
})

export const awsLambdaGetLayerVersionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/lambda/get-layer-version',
  body: GetLayerVersionSchema,
  response: { mode: 'json', schema: GetLayerVersionResponseSchema },
})
export type AwsLambdaGetLayerVersionRequest = ContractBodyInput<
  typeof awsLambdaGetLayerVersionContract
>
export type AwsLambdaGetLayerVersionBody = ContractBody<typeof awsLambdaGetLayerVersionContract>
export type AwsLambdaGetLayerVersionResponse = ContractJsonResponse<
  typeof awsLambdaGetLayerVersionContract
>
