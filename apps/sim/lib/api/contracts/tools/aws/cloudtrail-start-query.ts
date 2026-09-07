import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const StartQuerySchema = z
  .object({
    region: z
      .string()
      .min(1, 'AWS region is required')
      .refine((v) => validateAwsRegion(v).isValid, {
        message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
      }),
    accessKeyId: z.string().min(1, 'AWS access key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
    queryStatement: z.string().trim().min(1).max(10000).optional(),
    queryAlias: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(/^[a-zA-Z][a-zA-Z0-9._-]*$/, 'Invalid query alias format')
      .optional(),
    queryParameters: z.array(z.string().min(1).max(1024)).min(1).max(10).optional(),
    deliveryS3Uri: z
      .string()
      .trim()
      .max(1024)
      .regex(/^s3:\/\/[a-z0-9][.\-a-z0-9]{1,61}[a-z0-9](\/.*)?$/, 'Invalid S3 URI')
      .optional(),
    eventDataStoreOwnerAccountId: z
      .string()
      .trim()
      .min(12)
      .max(16)
      .regex(/^\d+$/, 'Account ID must be numeric')
      .optional(),
  })
  .refine((v) => Boolean(v.queryStatement) !== Boolean(v.queryAlias), {
    message: 'Specify exactly one of queryStatement or queryAlias',
    path: ['queryStatement'],
  })

const StartQueryResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    queryId: z.string(),
    eventDataStoreOwnerAccountId: z.string().nullable(),
  }),
})

export const awsCloudtrailStartQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/cloudtrail/start-query',
  body: StartQuerySchema,
  response: { mode: 'json', schema: StartQueryResponseSchema },
})
export type AwsCloudtrailStartQueryRequest = ContractBodyInput<
  typeof awsCloudtrailStartQueryContract
>
export type AwsCloudtrailStartQueryBody = ContractBody<typeof awsCloudtrailStartQueryContract>
export type AwsCloudtrailStartQueryResponse = ContractJsonResponse<
  typeof awsCloudtrailStartQueryContract
>
