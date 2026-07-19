import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const S3HeadObjectSchema = z.object({
  accessKeyId: z.string().min(1, 'Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret Access Key is required'),
  region: z.string().min(1, 'Region is required'),
  bucketName: z.string().min(1, 'Bucket name is required'),
  objectKey: z.string().min(1, 'Object key is required'),
  versionId: z.string().optional().nullable(),
})

const S3HeadObjectResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    exists: z.boolean(),
    contentLength: z.number().nullable(),
    contentType: z.string().nullable(),
    etag: z.string().nullable(),
    lastModified: z.string().nullable(),
    versionId: z.string().nullable(),
    storageClass: z.string().nullable(),
    serverSideEncryption: z.string().nullable(),
    deleteMarker: z.boolean().nullable(),
    metadata: z.record(z.string(), z.string()),
  }),
})

export const awsS3HeadObjectContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/s3/head-object',
  body: S3HeadObjectSchema,
  response: { mode: 'json', schema: S3HeadObjectResponseSchema },
})
export type AwsS3HeadObjectRequest = ContractBodyInput<typeof awsS3HeadObjectContract>
export type AwsS3HeadObjectBody = ContractBody<typeof awsS3HeadObjectContract>
export type AwsS3HeadObjectResponse = ContractJsonResponse<typeof awsS3HeadObjectContract>
