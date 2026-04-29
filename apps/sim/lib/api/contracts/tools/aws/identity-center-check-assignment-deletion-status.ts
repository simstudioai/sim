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
  requestId: z.string().min(1, 'Request ID is required'),
})

export const awsIdentityCenterCheckAssignmentDeletionStatusContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/check-assignment-deletion-status',
  body: Schema,
  response: { mode: 'json', schema: z.unknown() },
})
export type AwsIdentityCenterCheckAssignmentDeletionStatusRequest = ContractBodyInput<
  typeof awsIdentityCenterCheckAssignmentDeletionStatusContract
>
export type AwsIdentityCenterCheckAssignmentDeletionStatusBody = ContractBody<
  typeof awsIdentityCenterCheckAssignmentDeletionStatusContract
>
export type AwsIdentityCenterCheckAssignmentDeletionStatusResponse = ContractJsonResponse<
  typeof awsIdentityCenterCheckAssignmentDeletionStatusContract
>
