import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const S3PutObjectSchema = z.object({
  accessKeyId: z.string().min(1, 'Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret Access Key is required'),
  region: z.string().min(1, 'Region is required'),
  bucketName: z.string().min(1, 'Bucket name is required'),
  objectKey: z.string().min(1, 'Object key is required'),
  file: RawFileInputSchema.optional().nullable(),
  content: z.string().optional().nullable(),
  contentType: z.string().optional().nullable(),
  acl: z.string().optional().nullable(),
})

const S3PutObjectResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    url: z.string(),
    uri: z.string(),
    etag: z.string().optional(),
    location: z.string(),
    key: z.string(),
    bucket: z.string(),
  }),
})

export const awsS3PutObjectContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/s3/put-object',
  body: S3PutObjectSchema,
  response: { mode: 'json', schema: S3PutObjectResponseSchema },
})
export type AwsS3PutObjectRequest = ContractBodyInput<typeof awsS3PutObjectContract>
export type AwsS3PutObjectBody = ContractBody<typeof awsS3PutObjectContract>
export type AwsS3PutObjectResponse = ContractJsonResponse<typeof awsS3PutObjectContract>
