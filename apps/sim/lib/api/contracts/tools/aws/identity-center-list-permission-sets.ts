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
  maxResults: z.number().min(1).max(100).optional(),
  nextToken: z.string().optional(),
})

const ResponseSchema = z.object({
  permissionSets: z.array(
    z.object({
      permissionSetArn: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      sessionDuration: z.string().nullable(),
      createdDate: z.string().nullable(),
    })
  ),
  nextToken: z.string().nullable(),
  count: z.number(),
})

export const awsIdentityCenterListPermissionSetsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/identity-center/list-permission-sets',
  body: Schema,
  response: { mode: 'json', schema: ResponseSchema },
})
export type AwsIdentityCenterListPermissionSetsRequest = ContractBodyInput<
  typeof awsIdentityCenterListPermissionSetsContract
>
export type AwsIdentityCenterListPermissionSetsBody = ContractBody<
  typeof awsIdentityCenterListPermissionSetsContract
>
export type AwsIdentityCenterListPermissionSetsResponse = ContractJsonResponse<
  typeof awsIdentityCenterListPermissionSetsContract
>
