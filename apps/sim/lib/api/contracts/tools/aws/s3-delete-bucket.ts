import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const S3DeleteBucketSchema = z.object({
  accessKeyId: z.string().min(1, 'Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret Access Key is required'),
  region: z.string().min(1, 'Region is required'),
  bucketName: z.string().min(1, 'Bucket name is required'),
})

const S3DeleteBucketResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    deleted: z.literal(true),
    bucket: z.string(),
  }),
})

export const awsS3DeleteBucketContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/s3/delete-bucket',
  body: S3DeleteBucketSchema,
  response: { mode: 'json', schema: S3DeleteBucketResponseSchema },
})
export type AwsS3DeleteBucketRequest = ContractBodyInput<typeof awsS3DeleteBucketContract>
export type AwsS3DeleteBucketBody = ContractBody<typeof awsS3DeleteBucketContract>
export type AwsS3DeleteBucketResponse = ContractJsonResponse<typeof awsS3DeleteBucketContract>
