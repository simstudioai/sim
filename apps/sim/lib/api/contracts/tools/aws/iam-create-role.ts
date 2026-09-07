import { z } from 'zod'
import {
  iamAssumeRolePolicyDocumentSchema,
  iamConnectionShape,
  iamCreatePathSchema,
  iamRoleDescriptionSchema,
  iamRoleNameSchema,
} from '@/lib/api/contracts/tools/aws/iam-shared'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const Schema = z.object({
  ...iamConnectionShape,
  roleName: iamRoleNameSchema,
  assumeRolePolicyDocument: iamAssumeRolePolicyDocumentSchema,
  description: iamRoleDescriptionSchema.optional().nullable(),
  path: iamCreatePathSchema.optional().nullable(),
  maxSessionDuration: z
    .number()
    .int('Max session duration must be a whole number of seconds')
    .min(3600, 'Max session duration must be at least 3600 seconds (1 hour)')
    .max(43200, 'Max session duration cannot exceed 43200 seconds (12 hours)')
    .optional()
    .nullable(),
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
