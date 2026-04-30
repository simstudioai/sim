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
  roleName: z.string().min(1, 'Role name is required'),
  assumeRolePolicyDocument: z.string().min(1, 'Assume role policy document is required'),
  description: z.string().optional().nullable(),
  path: z.string().optional().nullable(),
  maxSessionDuration: z.number().int().min(3600).max(43200).optional().nullable(),
})

const CreateRoleResponseSchema = z.object({
  message: z.string(),
  roleName: z.string(),
  roleId: z.string(),
  arn: z.string(),
  path: z.string(),
  createDate: z.string().nullable(),
})

export const awsIamCreateRoleContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/create-role',
  body: Schema,
  response: { mode: 'json', schema: CreateRoleResponseSchema },
})
export type AwsIamCreateRoleRequest = ContractBodyInput<typeof awsIamCreateRoleContract>
export type AwsIamCreateRoleBody = ContractBody<typeof awsIamCreateRoleContract>
export type AwsIamCreateRoleResponse = ContractJsonResponse<typeof awsIamCreateRoleContract>
