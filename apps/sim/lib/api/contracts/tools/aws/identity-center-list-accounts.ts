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
  maxResults: z.number().min(1).max(20).optional(),
  nextToken: z.string().optional(),
})

const ResponseSchema = z.object({
  accounts: z.array(
    z.object({
      id: z.string(),
      arn: z.string(),
      name: z.string(),
      email: z.string(),
      status: z.string(),
      joinedTimestamp: z.string().nullable(),
    })
  ),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsIdentityCenterListAccountsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/list-accounts',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterListAccountsRequest = ContractBodyInput<
  typeof awsIdentityCenterListAccountsContract
>
export type AwsIdentityCenterListAccountsBody = ContractBody<
  typeof awsIdentityCenterListAccountsContract
>
export type AwsIdentityCenterListAccountsResponse = ContractJsonResponse<
  typeof awsIdentityCenterListAccountsContract
>
