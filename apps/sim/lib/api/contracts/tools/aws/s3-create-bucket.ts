import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const S3CreateBucketSchema = z.object({
  accessKeyId: z.string().min(1, 'Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret Access Key is required'),
  region: z.string().min(1, 'Region is required'),
  bucketName: z.string().min(1, 'Bucket name is required'),
  acl: z.string().optional().nullable(),
})

const S3CreateBucketResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    bucket: z.string(),
    location: z.string().nullable(),
    bucketArn: z.string().nullable(),
  }),
})

export const awsS3CreateBucketContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/s3/create-bucket',
  body: S3CreateBucketSchema,
  response: { mode: 'json', schema: S3CreateBucketResponseSchema },
})
export type AwsS3CreateBucketRequest = ContractBodyInput<typeof awsS3CreateBucketContract>
export type AwsS3CreateBucketBody = ContractBody<typeof awsS3CreateBucketContract>
export type AwsS3CreateBucketResponse = ContractJsonResponse<typeof awsS3CreateBucketContract>
