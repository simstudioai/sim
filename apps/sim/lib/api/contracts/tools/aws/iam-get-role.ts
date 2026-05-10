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
})

const GetRoleResponseSchema = z.object({
  roleName: z.string(),
  roleId: z.string(),
  arn: z.string(),
  path: z.string(),
  createDate: z.string().nullable(),
  description: z.string().nullable(),
  maxSessionDuration: z.number().nullable(),
  assumeRolePolicyDocument: z.string().nullable(),
  roleLastUsedDate: z.string().nullable(),
  roleLastUsedRegion: z.string().nullable(),
})

export const awsIamGetRoleContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/iam/get-role',
  body: Schema,
  response: { mode: 'json', schema: GetRoleResponseSchema },
})
export type AwsIamGetRoleRequest = ContractBodyInput<typeof awsIamGetRoleContract>
export type AwsIamGetRoleBody = ContractBody<typeof awsIamGetRoleContract>
export type AwsIamGetRoleResponse = ContractJsonResponse<typeof awsIamGetRoleContract>
