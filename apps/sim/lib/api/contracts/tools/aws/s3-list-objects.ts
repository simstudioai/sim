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

export const awsS3ListObjectsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/s3/list-objects',
  body: S3ListObjectsSchema,
  response: { mode: 'json', schema: z.unknown() },
})
export type AwsS3ListObjectsRequest = ContractBodyInput<typeof awsS3ListObjectsContract>
export type AwsS3ListObjectsBody = ContractBody<typeof awsS3ListObjectsContract>
export type AwsS3ListObjectsResponse = ContractJsonResponse<typeof awsS3ListObjectsContract>
