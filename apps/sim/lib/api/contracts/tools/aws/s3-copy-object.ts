import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const S3CopyObjectSchema = z.object({
  accessKeyId: z.string().min(1, 'Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret Access Key is required'),
  region: z.string().min(1, 'Region is required'),
  sourceBucket: z.string().min(1, 'Source bucket name is required'),
  sourceKey: z.string().min(1, 'Source object key is required'),
  destinationBucket: z.string().min(1, 'Destination bucket name is required'),
  destinationKey: z.string().min(1, 'Destination object key is required'),
  acl: z.string().optional().nullable(),
})

const S3CopyObjectResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    url: z.string(),
    uri: z.string(),
    copySourceVersionId: z.string().optional(),
    versionId: z.string().optional(),
    etag: z.string().optional(),
  }),
})

export const awsS3CopyObjectContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/s3/copy-object',
  body: S3CopyObjectSchema,
  response: { mode: 'json', schema: S3CopyObjectResponseSchema },
})
export type AwsS3CopyObjectRequest = ContractBodyInput<typeof awsS3CopyObjectContract>
export type AwsS3CopyObjectBody = ContractBody<typeof awsS3CopyObjectContract>
export type AwsS3CopyObjectResponse = ContractJsonResponse<typeof awsS3CopyObjectContract>
