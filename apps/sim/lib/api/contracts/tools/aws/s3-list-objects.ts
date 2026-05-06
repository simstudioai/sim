import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const S3ListObjectsSchema = z.object({
  accessKeyId: z.string().min(1, 'Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret Access Key is required'),
  region: z.string().min(1, 'Region is required'),
  bucketName: z.string().min(1, 'Bucket name is required'),
  prefix: z.string().optional().nullable(),
  maxKeys: z.number().optional().nullable(),
  continuationToken: z.string().optional().nullable(),
})

const S3ListObjectsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    objects: z.array(
      z.object({
        key: z.string(),
        size: z.number(),
        lastModified: z.string(),
        etag: z.string(),
      })
    ),
    isTruncated: z.boolean().optional(),
    nextContinuationToken: z.string().optional(),
    keyCount: z.number().optional(),
    prefix: z.string().nullish(),
  }),
})

export const awsS3ListObjectsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/s3/list-objects',
  body: S3ListObjectsSchema,
  response: { mode: 'json', schema: S3ListObjectsResponseSchema },
})
export type AwsS3ListObjectsRequest = ContractBodyInput<typeof awsS3ListObjectsContract>
export type AwsS3ListObjectsBody = ContractBody<typeof awsS3ListObjectsContract>
export type AwsS3ListObjectsResponse = ContractJsonResponse<typeof awsS3ListObjectsContract>
