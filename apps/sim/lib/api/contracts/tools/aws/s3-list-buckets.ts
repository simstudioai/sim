import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const S3ListBucketsSchema = z.object({
  accessKeyId: z.string().min(1, 'Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret Access Key is required'),
  region: z.string().min(1, 'Region is required'),
  prefix: z.string().optional().nullable(),
  maxBuckets: z.number().int().min(1).max(10000).optional().nullable(),
  continuationToken: z.string().optional().nullable(),
})

const S3ListBucketsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    buckets: z.array(
      z.object({
        name: z.string(),
        creationDate: z.string().nullable(),
        region: z.string().nullable(),
      })
    ),
    owner: z
      .object({
        displayName: z.string().nullable(),
        id: z.string().nullable(),
      })
      .nullable(),
    continuationToken: z.string().nullable(),
    prefix: z.string().nullable(),
  }),
})

export const awsS3ListBucketsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/s3/list-buckets',
  body: S3ListBucketsSchema,
  response: { mode: 'json', schema: S3ListBucketsResponseSchema },
})
export type AwsS3ListBucketsRequest = ContractBodyInput<typeof awsS3ListBucketsContract>
export type AwsS3ListBucketsBody = ContractBody<typeof awsS3ListBucketsContract>
export type AwsS3ListBucketsResponse = ContractJsonResponse<typeof awsS3ListBucketsContract>
