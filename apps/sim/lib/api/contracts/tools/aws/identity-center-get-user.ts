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
  email: z.string().email('Valid email address is required'),
})

const ResponseSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
})

export const awsIdentityCenterGetUserContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/get-user',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterGetUserRequest = ContractBodyInput<
  typeof awsIdentityCenterGetUserContract
>
export type AwsIdentityCenterGetUserBody = ContractBody<typeof awsIdentityCenterGetUserContract>
export type AwsIdentityCenterGetUserResponse = ContractJsonResponse<
  typeof awsIdentityCenterGetUserContract
>
