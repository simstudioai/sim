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
  instanceArn: z.string().min(1, 'Instance ARN is required'),
  accountId: z.string().min(1, 'Account ID is required'),
  permissionSetArn: z.string().min(1, 'Permission set ARN is required'),
  principalType: z.enum(['USER', 'GROUP']),
  principalId: z.string().min(1, 'Principal ID is required'),
})

const ResponseSchema = z.object({
  message: z.string(),
  status: z.string(),
  requestId: z.string(),
  accountId: z.string().nullable(),
  permissionSetArn: z.string().nullable(),
  principalType: z.string().nullable(),
  principalId: z.string().nullable(),
  failureReason: z.string().nullable(),
  createdDate: z.string().nullable(),
})

export const awsIdentityCenterDeleteAccountAssignmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/delete-account-assignment',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterDeleteAccountAssignmentRequest = ContractBodyInput<
  typeof awsIdentityCenterDeleteAccountAssignmentContract
>
export type AwsIdentityCenterDeleteAccountAssignmentBody = ContractBody<
  typeof awsIdentityCenterDeleteAccountAssignmentContract
>
export type AwsIdentityCenterDeleteAccountAssignmentResponse = ContractJsonResponse<
  typeof awsIdentityCenterDeleteAccountAssignmentContract
>
