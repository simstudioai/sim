import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const S3DeleteObjectsSchema = z.object({
  accessKeyId: z.string().min(1, 'Access Key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret Access Key is required'),
  region: z.string().min(1, 'Region is required'),
  bucketName: z.string().min(1, 'Bucket name is required'),
  keys: z
    .array(z.string().min(1, 'Object key cannot be empty'))
    .min(1, 'At least one object key is required')
    .max(1000, 'A maximum of 1000 keys can be deleted per request'),
  quiet: z.boolean().optional().nullable(),
})

const S3DeleteObjectsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    deleted: z.array(
      z.object({
        key: z.string().nullable(),
        versionId: z.string().nullable(),
        deleteMarker: z.boolean().nullable(),
      })
    ),
    errors: z.array(
      z.object({
        key: z.string().nullable(),
        code: z.string().nullable(),
        message: z.string().nullable(),
      })
    ),
  }),
})

export const awsS3DeleteObjectsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/s3/delete-objects',
  body: S3DeleteObjectsSchema,
  response: { mode: 'json', schema: S3DeleteObjectsResponseSchema },
})
export type AwsS3DeleteObjectsRequest = ContractBodyInput<typeof awsS3DeleteObjectsContract>
export type AwsS3DeleteObjectsBody = ContractBody<typeof awsS3DeleteObjectsContract>
export type AwsS3DeleteObjectsResponse = ContractJsonResponse<typeof awsS3DeleteObjectsContract>
