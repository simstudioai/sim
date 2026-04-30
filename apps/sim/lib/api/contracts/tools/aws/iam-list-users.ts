import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const Schema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  pathPrefix: z.string().optional().nullable(),
  maxItems: z.number().int().min(1).max(1000).optional().nullable(),
  marker: z.string().optional().nullable(),
})

const ListUsersResponseSchema = z.object({
  users: z.array(
    z.object({
      userName: z.string(),
      userId: z.string(),
      arn: z.string(),
      path: z.string(),
      createDate: z.string().nullable(),
      passwordLastUsed: z.string().nullable(),
    })
  ),
  isTruncated: z.boolean(),
  marker: z.string().nullable(),
  count: z.number(),
})

export const awsIamListUsersContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/list-users',
  body: Schema,
  response: { mode: 'json', schema: ListUsersResponseSchema },
})
export type AwsIamListUsersRequest = ContractBodyInput<typeof awsIamListUsersContract>
export type AwsIamListUsersBody = ContractBody<typeof awsIamListUsersContract>
export type AwsIamListUsersResponse = ContractJsonResponse<typeof awsIamListUsersContract>
