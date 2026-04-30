import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const S3DeleteObjectSchema = z.object({
  accessKeyId: z.string().min(1, 'Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret Access Key is required'),
  region: z.string().min(1, 'Region is required'),
  bucketName: z.string().min(1, 'Bucket name is required'),
  objectKey: z.string().min(1, 'Object key is required'),
})

const S3DeleteObjectResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    key: z.string(),
    deleteMarker: z.boolean().optional(),
    versionId: z.string().optional(),
  }),
})

export const awsS3DeleteObjectContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/s3/delete-object',
  body: S3DeleteObjectSchema,
  response: { mode: 'json', schema: S3DeleteObjectResponseSchema },
})
export type AwsS3DeleteObjectRequest = ContractBodyInput<typeof awsS3DeleteObjectContract>
export type AwsS3DeleteObjectBody = ContractBody<typeof awsS3DeleteObjectContract>
export type AwsS3DeleteObjectResponse = ContractJsonResponse<typeof awsS3DeleteObjectContract>
