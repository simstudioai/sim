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
  accountId: z.string().min(12, 'Account ID must be 12 digits').max(12),
})

const ResponseSchema = z.object({
  id: z.string(),
  arn: z.string(),
  name: z.string(),
  email: z.string(),
  status: z.string(),
  joinedTimestamp: z.string().nullable(),
})

export const awsIdentityCenterDescribeAccountContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/describe-account',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterDescribeAccountRequest = ContractBodyInput<
  typeof awsIdentityCenterDescribeAccountContract
>
export type AwsIdentityCenterDescribeAccountBody = ContractBody<
  typeof awsIdentityCenterDescribeAccountContract
>
export type AwsIdentityCenterDescribeAccountResponse = ContractJsonResponse<
  typeof awsIdentityCenterDescribeAccountContract
>
