import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const ListTrailsSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  nextToken: z.string().optional(),
})

const ListTrailsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    trails: z.array(
      z.object({
        trailArn: z.string().nullable(),
        name: z.string().nullable(),
        homeRegion: z.string().nullable(),
      })
    ),
    nextToken: z.string().nullable(),
  }),
})

export const awsCloudtrailListTrailsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudtrail/list-trails',
  body: ListTrailsSchema,
  response: { mode: 'json', schema: ListTrailsResponseSchema },
})
export type AwsCloudtrailListTrailsRequest = ContractBodyInput<
  typeof awsCloudtrailListTrailsContract
>
export type AwsCloudtrailListTrailsBody = ContractBody<typeof awsCloudtrailListTrailsContract>
export type AwsCloudtrailListTrailsResponse = ContractJsonResponse<
  typeof awsCloudtrailListTrailsContract
>
