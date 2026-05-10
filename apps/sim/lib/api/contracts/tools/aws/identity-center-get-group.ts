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
  displayName: z.string().min(1, 'Group display name is required'),
})

const ResponseSchema = z.object({
  groupId: z.string(),
  displayName: z.string().nullable(),
  description: z.string().nullable(),
})

export const awsIdentityCenterGetGroupContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/get-group',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterGetGroupRequest = ContractBodyInput<
  typeof awsIdentityCenterGetGroupContract
>
export type AwsIdentityCenterGetGroupBody = ContractBody<typeof awsIdentityCenterGetGroupContract>
export type AwsIdentityCenterGetGroupResponse = ContractJsonResponse<
  typeof awsIdentityCenterGetGroupContract
>
