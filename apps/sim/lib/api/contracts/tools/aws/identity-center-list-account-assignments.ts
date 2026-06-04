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
  principalId: z.string().min(1, 'Principal ID is required'),
  principalType: z.enum(['USER', 'GROUP']),
  maxResults: z.number().min(1).max(100).optional(),
  nextToken: z.string().optional(),
})

const ResponseSchema = z.object({
  assignments: z.array(
    z.object({
      accountId: z.string(),
      permissionSetArn: z.string(),
      principalType: z.string(),
      principalId: z.string(),
    })
  ),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsIdentityCenterListAccountAssignmentsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/list-account-assignments',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterListAccountAssignmentsRequest = ContractBodyInput<
  typeof awsIdentityCenterListAccountAssignmentsContract
>
export type AwsIdentityCenterListAccountAssignmentsBody = ContractBody<
  typeof awsIdentityCenterListAccountAssignmentsContract
>
export type AwsIdentityCenterListAccountAssignmentsResponse = ContractJsonResponse<
  typeof awsIdentityCenterListAccountAssignmentsContract
>
