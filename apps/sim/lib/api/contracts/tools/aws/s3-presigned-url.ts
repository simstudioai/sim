import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const S3PresignedUrlSchema = z.object({
  accessKeyId: z.string().min(1, 'Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret Access Key is required'),
  region: z.string().min(1, 'Region is required'),
  bucketName: z.string().min(1, 'Bucket name is required'),
  objectKey: z.string().min(1, 'Object key is required'),
  method: z.enum(['get', 'put']),
  expiresIn: z.number().int().min(1).max(604800),
  contentType: z.string().optional().nullable(),
})

const S3PresignedUrlResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    url: z.string(),
    method: z.enum(['get', 'put']),
    expiresIn: z.number(),
    expiresAt: z.string(),
  }),
})

export const awsS3PresignedUrlContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/s3/presigned-url',
  body: S3PresignedUrlSchema,
  response: { mode: 'json', schema: S3PresignedUrlResponseSchema },
})
export type AwsS3PresignedUrlRequest = ContractBodyInput<typeof awsS3PresignedUrlContract>
export type AwsS3PresignedUrlBody = ContractBody<typeof awsS3PresignedUrlContract>
export type AwsS3PresignedUrlResponse = ContractJsonResponse<typeof awsS3PresignedUrlContract>
