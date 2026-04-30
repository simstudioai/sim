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
  identityStoreId: z.string().min(1, 'Identity Store ID is required'),
  maxResults: z.number().min(1).max(100).optional(),
  nextToken: z.string().optional(),
})

const ResponseSchema = z.object({
  groups: z.array(
    z.object({
      groupId: z.string(),
      displayName: z.string().nullable(),
      description: z.string().nullable(),
      externalIds: z.array(z.object({ issuer: z.string(), id: z.string() })),
    })
  ),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsIdentityCenterListGroupsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/list-groups',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterListGroupsRequest = ContractBodyInput<
  typeof awsIdentityCenterListGroupsContract
>
export type AwsIdentityCenterListGroupsBody = ContractBody<
  typeof awsIdentityCenterListGroupsContract
>
export type AwsIdentityCenterListGroupsResponse = ContractJsonResponse<
  typeof awsIdentityCenterListGroupsContract
>
